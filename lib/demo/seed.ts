/**
 * Demo seed: builds the four fictional companies of one private sandbox
 * (lib/demo/sandbox) for the sandbox's visitor, companyAdmin of each in the
 * director persona (the default):
 * - Atelier Lumen (SASU, design studio),
 * - Maison Verdier (EURL, online delicatessen),
 * - SCI Les Tilleuls (SCI at IS, residential building),
 * - Lumen Holding (SAS, owns Atelier Lumen and Maison Verdier and 40% of
 *   SCI Les Tilleuls: the group of lib/demo/qonto/profiles/group.ts, with
 *   its fictional shareholders and officers, lib/demo/people).
 * For each one:
 * - fiscal year 2025, fully booked from the generated bank activity and
 *   closed with the app's closing service,
 * - fiscal year 2026, open, booked up to the end of the month before last,
 * - fixed assets with their 2025 depreciation, tax regimes,
 * - a Qonto integration connected to the simulated API with the sandbox's
 *   own credentials, synced once: recent bank transactions stay
 *   unreconciled for visitors to process,
 * - transaction rules (règles d'affectation) matching the recurring payees,
 *   not applied: the recurring, unambiguous ones apply on "Actualiser et
 *   rapprocher" (autoCreate), the variable ones (fuel, supplies, travel)
 *   are suggested for a one-click application.
 *
 * In the accountant persona (lib/demo/sandbox/persona.ts) the visitor is
 * `accountant` of each company and every company gets its fictional manager
 * (companyAdmin, a user without credentials, banned, so it can never sign
 * in). The books differ in two ways that give the accountant work, both
 * keeping every entry balanced:
 * - the 2026 entries dated from the 16th of the last booked month stay
 *   drafts with provisional numbers (validated ones keep a gapless
 *   sequence; validation numbers the drafts next, PCG art. 1031-3),
 * - Lumen Holding's 2025 stays open, ready to close (its 2026 opening
 *   entries come with the closing).
 * The admin persona has the director's books, with the fictional managers
 * as fellow members and instance users (the visitor is companyAdmin).
 *
 * Built for a remote database: rows are prepared in memory with client-side
 * ids and written with a few createMany statements instead of one round trip
 * per row. The initial bank sync calls the simulated API in-process through
 * an injected provider (no HTTP, nothing global patched), so several
 * sandboxes can be seeded at once. seedDemoCompanies only touches the rows
 * of the companies it creates (slugs suffixed with the sandbox key, SIREN
 * numbers drawn per sandbox). Refuses to run outside demo mode.
 */

import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { DEFAULT_JOURNALS } from '@/lib/accounting/default-journals'
import { validateAccountingEntry } from '@/lib/accounting/validator'
import { ensureCompanyOrganization } from '@/lib/rbac/ensure-company-organization.service'
import { closeFiscalYear } from '@/lib/accounting/fiscal-year-closure'
import { encrypt, integrationContext } from '@/lib/integrations/encryption'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { syncIntegration } from '@/lib/integrations/sync'
import { slugify } from '@/lib/companies/slug'
import { IntegrationFeature } from '@/lib/integrations/types'
import { getOrCreateDefaultBalanceSheetConfig } from '@/lib/reports/balance-sheet/config/create-default-pcg-config.service'
import { getOrCreateDefaultIncomeStatementConfig } from '@/lib/reports/income-statement/config/create-default-pcg-config.service'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { validateBalanceSheetBalance } from '@/lib/reports/statements/balance-sheet'
import { getQontoApiUrl } from '@/lib/integrations/providers/qonto/client-base'
import { DEMO_QONTO_API_PATH, isDemoMode } from '@/lib/demo/mode'
import { DEMO_COMPANIES, type DemoCompany } from '@/lib/demo/companies'
import { createId } from '@/lib/crypto/ids'
import { demoQontoCredentials } from '@/lib/demo/qonto/credentials'
import { InProcessDemoQontoProvider } from '@/lib/demo/qonto/provider'
import { isSandboxKey, randomSiren, sandboxSlugSuffix } from '@/lib/demo/sandbox/identity'
import { DEFAULT_DEMO_PERSONA, directorEmail, PERSONA_ROLES, personaHasDirectors, type DemoPersona } from '@/lib/demo/sandbox/persona'
import { provisionalEntryNumber } from '@/lib/accounting/services/generate-next-entry-number.service'
import {
  DEMO_BANK_LEDGER,
  parseDateKey,
  round2,
  toDateKey,
  type FiscalYearSummary,
  type LedgerEntry,
} from '@/lib/demo/qonto/engine'
import { DEMO_API_HISTORY_DAYS, profileBySlug, type DemoBankProfile } from '@/lib/demo/qonto/profiles'
import { GROUP_STAKES, HOLDING_SLUG } from '@/lib/demo/qonto/profiles/group'
import { DEMO_PERSON_ROLES, demoPerson, demoPersonEmail, demoPersonNotes, demoPersonPhoto } from '@/lib/demo/people'
import { DIRECTOR_REIMBURSEMENT } from '@/lib/demo/expense-reports'
import { DEMO_BUDGETS, planBudget2026 } from '@/lib/demo/budgets'
import {
  collectGroupBookings,
  seedBudgets,
  seedDirectorExpenseReports,
  seedGroupInvoices,
  type ExpenseReportSeedResult,
  type GroupBooking,
  type GroupSeedResult,
} from '@/lib/demo/seed-features'

export interface DemoCompanySeedResult {
  companyId: string
  name: string
  legalForm: string
  fiscalYear2025: FiscalYearSummary & {
    balanceSheetBalanced: boolean
    imbalance?: number
    balanceSheetTotal: number
    closed: boolean
  }
  entries2025: number
  entries2026: number
  /** 2026 entries left as drafts (accountant persona). */
  drafts2026: number
  bankTransactionsSynced: number
  bankTransactionsUnreconciled: number
  rules: number
}

export interface DemoCompaniesSeedOptions {
  /** The visitor: companyAdmin of every created company, or accountant in the accountant persona. */
  ownerId: string
  /** Who the visitor plays (lib/demo/sandbox/persona.ts); director by default. */
  persona?: DemoPersona
  /** Sandbox key (lib/demo/sandbox/identity.ts): slug suffix and Qonto logins. */
  sandboxKey: string
  now?: Date
  log?: Log
}

export interface DemoCompaniesSeedResult {
  ledgerCutoff: string
  companies: DemoCompanySeedResult[]
  /** Management features seeded on top of the books (lib/demo/seed-features.ts). */
  features: {
    /** Intragroup invoices on both sides, the management fee convention and its billings. */
    group: GroupSeedResult | null
    expenseReports: ExpenseReportSeedResult | null
    /** Companies with a 2026 budget. */
    budgets: number
  }
}

type Log = (message: string) => void

/** Last day of the month before last: the 2026 books are kept up to there. */
export function demoLedgerCutoff(now: Date): string {
  return toDateKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 0)))
}

/**
 * Accountant persona: 2026 entries dated from this day on stay drafts (the
 * second half of the last booked month, prepared by the manager and left
 * for the accountant to review and validate).
 */
export function demoDraftsFrom(cutoff: string): string {
  return `${cutoff.slice(0, 8)}16`
}

/** Name shown for the demo bank accounts (BankAccount.displayName), never their slug. */
export const DEMO_BANK_ACCOUNT_DISPLAY_NAME = 'Compte principal Qonto'

/** Accountant persona: the company whose 2025 stays open, ready to close. */
export const ACCOUNTANT_OPEN_2025_PROFILE = 'lumen-holding'

/**
 * Removes every row from every application table (keeps the migrations
 * table): every sandbox goes. Used by `pnpm demo:seed` only.
 */
export async function wipeDemoDatabase(): Promise<void> {
  if (!isDemoMode()) {
    throw new Error('Refusing to wipe: KLEDG_DEMO_MODE is not "true".')
  }
  // One statement, names quoted by format('%I'): no SQL is built in JavaScript.
  // TRUNCATE fires no row trigger (the append-only audit log is emptied too).
  await prisma.$executeRaw`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO tables
      FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END
    $$
  `
}

/** Splits rows into createMany statements of at most `size` rows (bind parameter limit). */
async function createInChunks<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size))
}

// ── Chart of accounts ──────────────────────────────────────────────────────

const PCG_BY_CODE = new Map(PCG_ACCOUNTS.map((a) => [a.code, a]))

/** PCG accounts ordered parents first (same data as prisma/seeds/pcg.ts, all optional accounts included). */
const PCG_PARENTS_FIRST = (() => {
  const depth = (code: string): number => {
    let d = 0
    let current = PCG_BY_CODE.get(code)
    while (current?.parentCode && PCG_BY_CODE.has(current.parentCode)) {
      d += 1
      current = PCG_BY_CODE.get(current.parentCode)
    }
    return d
  }
  return [...PCG_ACCOUNTS].sort((a, b) => depth(a.code) - depth(b.code))
})()

/** The codes and all their PCG parents. */
function withParents(codes: Iterable<string>): Set<string> {
  const result = new Set<string>()
  for (const code of codes) {
    for (let current = PCG_BY_CODE.get(code); current && !result.has(current.code); ) {
      result.add(current.code)
      current = current.parentCode ? PCG_BY_CODE.get(current.parentCode) : undefined
    }
  }
  return result
}

/**
 * The PCG chart of a fiscal year: every account, or only `codes` (with
 * their parents) for a closed year whose books are already complete.
 */
function chartOfAccounts(
  companyId: string,
  fiscalYearId: string,
  codes?: Set<string>,
  subAccounts: ReadonlyArray<{ code: string; label: string }> = [],
): {
  rows: Prisma.AccountCreateManyInput[]
  ids: Map<string, string>
} {
  const ids = new Map<string, string>()
  const rows: Prisma.AccountCreateManyInput[] = []
  for (const account of PCG_PARENTS_FIRST) {
    if (ids.has(account.code) || (codes && !codes.has(account.code))) continue
    const id = createId()
    ids.set(account.code, id)
    rows.push({
      id,
      code: account.code,
      label: account.label,
      companyId,
      fiscalYearId,
      parentId: account.parentCode ? ids.get(account.parentCode) ?? null : null,
      isPCG: true,
    })
  }
  // Subdivisions of the PCG (PCG art. 932-1), under their longest PCG prefix,
  // with the parent's nomenclature like createAccount (create-account.service.ts).
  for (const sub of subAccounts) {
    let parent = sub.code.slice(0, -1)
    while (parent.length > 1 && !ids.has(parent)) parent = parent.slice(0, -1)
    const parentId = ids.get(parent)
    if (!parentId) throw new Error(`Demo seed: no parent account for ${sub.code}`)
    const id = createId()
    ids.set(sub.code, id)
    rows.push({ id, code: sub.code, label: sub.label, companyId, fiscalYearId, parentId, isPCG: true })
  }
  return { rows, ids }
}

// ── Ledger rows ────────────────────────────────────────────────────────────

interface LedgerRows {
  entries: Prisma.AccountingEntryCreateManyInput[]
  /** Ids of the entries left as drafts (not validated by insertLedger). */
  drafts: Set<string>
  lines: Prisma.EntryLineCreateManyInput[]
  /** Entry id by bank transaction id. */
  entryByTransaction: Map<string, string>
  /** Entry id by reference. */
  entryByReference: Map<string, string>
}

/**
 * Turns ledger entries into rows, checked with the same validation as
 * createAccountingEntry (balance, amounts, PCG rules). Entries dated from
 * `draftsFrom` on stay drafts with a provisional number, like drafts saved
 * in the app; the others are numbered in sequence from `firstNumber`.
 */
function ledgerRows(
  company: { id: string; name: string },
  fiscalYearId: string,
  accounts: Map<string, string>,
  journals: Map<string, string>,
  entries: LedgerEntry[],
  firstNumber: number,
  draftsFrom?: string
): LedgerRows {
  const rows: LedgerRows = { entries: [], drafts: new Set(), lines: [], entryByTransaction: new Map(), entryByReference: new Map() }
  let next = firstNumber
  entries.forEach((entry) => {
    const id = createId()
    const draft = draftsFrom !== undefined && entry.date >= draftsFrom
    const entryNumber = draft ? provisionalEntryNumber() : String(next++)
    if (draft) rows.drafts.add(id)
    const journalId = journals.get(entry.journal)
    if (!journalId) throw new Error(`Demo seed (${company.name}): journal ${entry.journal} missing`)
    const lines = entry.lines.map((line) => {
      const accountId = accounts.get(line.account)
      if (!accountId) throw new Error(`Demo seed (${company.name}): account ${line.account} missing`)
      return {
        accountId,
        debit: round2(line.debit ?? 0),
        credit: round2(line.credit ?? 0),
        description: line.description ?? entry.description,
        auxiliary: line.auxiliary,
      }
    })
    const date = parseDateKey(entry.date)
    const validation = validateAccountingEntry({ date, lines: lines.map(({ auxiliary, ...line }) => (void auxiliary, line)), description: entry.description })
    if (!validation.valid) {
      throw new Error(`Demo seed (${company.name}): invalid entry ${entry.reference}: ${validation.errors.join(', ')}`)
    }
    rows.entries.push({
      id,
      entryNumber,
      date,
      journalId,
      companyId: company.id,
      fiscalYearId,
      description: entry.description,
      reference: entry.reference,
      // Inserted as drafts, validated by insertLedger once their lines exist
      // (the database refuses lines added to a validated entry), except the
      // drafts left for the accountant persona.
      status: 'draft',
    })
    for (const line of lines) {
      rows.lines.push({
        id: createId(),
        accountingEntryId: id,
        accountingEntryNumber: entryNumber,
        accountId: line.accountId,
        accountFiscalYearId: fiscalYearId,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        auxiliaryAccountNumber: line.auxiliary?.number ?? null,
        auxiliaryAccountLabel: line.auxiliary?.label ?? null,
      })
    }
    if (entry.transactionId) rows.entryByTransaction.set(entry.transactionId, id)
    rows.entryByReference.set(entry.reference, id)
  })
  return rows
}

async function insertLedger(rows: LedgerRows): Promise<void> {
  await createInChunks(rows.entries, 2000, (data) => prisma.accountingEntry.createMany({ data }))
  await createInChunks(rows.lines, 2000, (data) => prisma.entryLine.createMany({ data }))
  // Validation: the generated entries are booked as they happen, so each one
  // is validated on its own date (FEC ValidDate).
  const toValidate = rows.entries.filter((entry) => !rows.drafts.has(entry.id as string))
  await createInChunks(toValidate, 2000, async (data) => {
    const ids = data.map((entry) => entry.id as string)
    return prisma.$executeRaw`
      UPDATE "accounting_entries" SET "status" = 'validated', "validatedAt" = "date"
      WHERE "id" = ANY(${ids}::text[])
    `
  })
}

// ── Report configurations ──────────────────────────────────────────────────

/**
 * Creates the default report configurations of the first company with the
 * app's services, then copies those rows to the other companies (same
 * content, new ids), instead of one insert per line and per company.
 */
async function createReportConfigs(companyIds: string[]): Promise<void> {
  const [first, ...others] = companyIds
  await Promise.all(
    (['complete', 'simplified'] as const).flatMap((variant) => [
      getOrCreateDefaultBalanceSheetConfig(first, variant),
      getOrCreateDefaultIncomeStatementConfig(first, variant),
    ])
  )
  if (others.length === 0) return

  const [balanceSheetLines, incomeStatementLines] = await Promise.all([
    prisma.balanceSheetLineConfig.findMany({ where: { companyId: first } }),
    prisma.incomeStatementLineConfig.findMany({ where: { companyId: first } }),
  ])
  const copy = <T extends { id: string; companyId: string; parentId: string | null }>(
    rows: T[],
    companyId: string
  ) => {
    const ids = new Map(rows.map((row) => [row.id, createId()]))
    const parents = new Map(rows.map((row) => [row.id, row.parentId]))
    const depth = (id: string | null): number => (id && parents.get(id) ? 1 + depth(parents.get(id)!) : 0)
    const parentsFirst = [...rows].sort((a, b) => depth(a.id) - depth(b.id))
    return parentsFirst.map((row) => ({
      ...row,
      id: ids.get(row.id)!,
      companyId,
      parentId: row.parentId ? ids.get(row.parentId) ?? null : null,
    }))
  }
  const balanceSheetCopies = others.flatMap((companyId) => copy(balanceSheetLines, companyId))
  const incomeStatementCopies = others.flatMap((companyId) => copy(incomeStatementLines, companyId))
  await createInChunks(balanceSheetCopies, 1000, (data) =>
    prisma.balanceSheetLineConfig.createMany({ data: data as Prisma.BalanceSheetLineConfigCreateManyInput[] })
  )
  await createInChunks(incomeStatementCopies, 1000, (data) =>
    prisma.incomeStatementLineConfig.createMany({ data: data as Prisma.IncomeStatementLineConfigCreateManyInput[] })
  )
}

// ── Seed ────────────────────────────────────────────────────────────────────

interface CompanyPlan {
  company: DemoCompany
  profile: DemoBankProfile
  id: string
  addressId: string
  fy2025: string
  fy2026: string
  accounts2025: Map<string, string>
  accounts2026: Map<string, string>
  journals: Map<string, string>
  integrationId: string
  result: Partial<DemoCompanySeedResult>
}

/**
 * Creates the four demo companies for `ownerId`, fully booked, with their
 * simulated Qonto accounts synced and their rules. Never touches rows of
 * other companies.
 */
export async function seedDemoCompanies(options: DemoCompaniesSeedOptions): Promise<DemoCompaniesSeedResult> {
  if (!isDemoMode()) {
    throw new Error('Refusing to seed: KLEDG_DEMO_MODE is not "true".')
  }
  if (!isSandboxKey(options.sandboxKey)) throw new Error(`Invalid sandbox key ${options.sandboxKey}`)
  const now = options.now ?? new Date()
  const log: Log = options.log ?? (() => {})
  const persona = options.persona ?? DEFAULT_DEMO_PERSONA
  const accountant = persona === 'accountant'
  const slugSuffix = sandboxSlugSuffix(options.sandboxKey)
  const cutoff = demoLedgerCutoff(now)
  const encryptionKey = getEncryptionKey()
  if (!encryptionKey) throw new Error('Encryption key not configured (BETTER_AUTH_SECRET or ENCRYPTION_KEY).')
  const user = { id: options.ownerId }

  // Every sandbox gets its own SIREN numbers (unique in the database).
  const plans: CompanyPlan[] = DEMO_COMPANIES.map((company) => ({
    company: { ...company, ...randomSiren() },
    profile: profileBySlug(company.profile),
    id: createId(),
    addressId: createId(),
    fy2025: createId(),
    fy2026: createId(),
    accounts2025: new Map(),
    accounts2026: new Map(),
    journals: new Map(),
    integrationId: createId(),
    result: { name: company.name, legalForm: company.legalForm, rules: company.rules.length },
  }))

  // ── Companies, same fields as POST /api/companies ──
  log(`Creating ${plans.map((p) => p.company.name).join(', ')}`)
  await prisma.company.createMany({
    data: plans.map(({ company: c, id }) => {
      const vatKey = (12 + 3 * (Number(c.siren) % 97)) % 97
      return {
        id,
        name: c.name,
        // Demo names are distinct, so their slugs are too (the sandbox
        // suffix separates the copies of each visitor).
        slug: `${slugify(c.name)}${slugSuffix}`,
        siren: c.siren,
        email: c.email,
        phone: c.phone,
        foundationDate: parseDateKey(c.foundationDate),
        closingDay: 31,
        closingMonth: 12,
        vatRegime: c.vatRegime,
        isVatExempt: c.isVatExempt,
        vatExemptReason: c.vatExemptReason,
        servicesVatOnDebits: c.servicesVatOnDebits ?? false,
        vatNumber: c.isVatExempt ? null : `FR${String(vatKey).padStart(2, '0')}${c.siren}`,
        corporateTaxRegime: c.corporateTaxRegime,
        legalType: c.legalType,
        legalForm: c.legalForm,
        sector: c.sector,
        isHolding: c.isHolding,
        activityCode: c.activityCode,
        taxOffice: c.taxOffice,
        totalShares: c.totalShares,
        shareNominalValue: c.shareNominalValue,
        shareCapital: c.totalShares * c.shareNominalValue,
        defaultBankAccountCode: DEMO_BANK_LEDGER,
        color: c.color,
      }
    }),
  })
  // Each address belongs to its company (Address.companyId), so it comes
  // after the company, then becomes its address and headquarters.
  await prisma.address.createMany({
    data: plans.map((p) => ({ id: p.addressId, companyId: p.id, ...p.company.address, country: 'FR' })),
  })
  await Promise.all(
    plans.map((p) =>
      prisma.company.update({ where: { id: p.id }, data: { addressId: p.addressId, headquartersAddressId: p.addressId } }),
    ),
  )
  const organizations: string[] = []
  for (const plan of plans) organizations.push((await ensureCompanyOrganization(plan.id)).id)
  // Accountant and admin personas: each company's fictional manager, one account per
  // person (Claire Vasseur runs both Atelier Lumen and its holding). No
  // credential row and banned: the account can never sign in.
  const directors = personaHasDirectors(persona) ? [...new Map(plans.map(({ company }) => [company.director.login, company.director])).values()] : []
  const directorIds = new Map(directors.map((director) => [director.login, randomUUID()]))
  if (directors.length > 0) {
    await prisma.user.createMany({
      data: directors.map((director) => ({
        id: directorIds.get(director.login)!,
        email: directorEmail(director.login, options.sandboxKey),
        name: director.name,
        emailVerified: false,
        role: 'user',
        banned: true,
        banReason: 'Compte fictif de la démo : connexion impossible.',
        createdAt: now,
        updatedAt: now,
      })),
    })
  }
  await prisma.member.createMany({
    data: organizations.flatMap((organizationId, index) => {
      const director = directorIds.get(plans[index].company.director.login)
      return [
        { id: randomUUID(), organizationId, userId: user.id, role: PERSONA_ROLES[persona], createdAt: now },
        ...(director ? [{ id: randomUUID(), organizationId, userId: director, role: 'companyAdmin', createdAt: now }] : []),
      ]
    }),
  })
  const journalRows = plans.flatMap((plan) =>
    DEFAULT_JOURNALS.map((j) => {
      const id = createId()
      plan.journals.set(j.code, id)
      return { id, code: j.code, label: j.label, companyId: plan.id }
    })
  )
  await prisma.journal.createMany({ data: journalRows })
  await prisma.establishment.createMany({
    data: plans.map(({ company: c, id, addressId }) => ({
      companyId: id,
      siret: c.siret,
      siren: c.siren,
      name: 'Siège social',
      addressId,
      activityCode: c.activityCode,
      isMain: true,
    })),
  })
  await prisma.taxRegimeHistory.createMany({
    data: plans.flatMap(({ company: c, id }) => [
      ...(c.vatRegime ? [{ companyId: id, regimeType: 'vat', regime: c.vatRegime, startDate: parseDateKey(c.foundationDate) }] : []),
      { companyId: id, regimeType: 'corporateTax', regime: c.corporateTaxRegime, startDate: parseDateKey(c.foundationDate) },
    ]),
  })
  // The group: Lumen Holding among the shareholders of the companies it
  // holds (Kledg's definition of a holding, lib/management-fees/holding.ts),
  // then the fictional people, each a Person of the company they belong to,
  // a natural-person shareholder where they hold shares.
  const planOf = (slug: string) => plans.find((p) => p.profile.engine.slug === slug)
  const holding = planOf(HOLDING_SLUG)
  const shareholderRows: Prisma.ShareholderCreateManyInput[] = []
  if (holding) {
    for (const stake of GROUP_STAKES) {
      const held = planOf(stake.slug)
      if (!held) continue
      shareholderRows.push({
        companyId: held.id,
        type: 'LEGAL',
        companyShareholderId: holding.id,
        sharePercentage: stake.percent,
        numberOfShares: stake.shares,
        capitalAmount: stake.shares * held.company.shareNominalValue,
      })
    }
  }
  const personRows: Prisma.PersonCreateManyInput[] = []
  for (const role of DEMO_PERSON_ROLES) {
    const plan = planOf(role.company)
    if (!plan) continue
    const person = demoPerson(role.person)
    const personId = createId()
    personRows.push({
      id: personId,
      companyId: plan.id,
      firstName: person.firstName,
      name: person.name,
      email: demoPersonEmail(person, plan.company.email),
      photo: demoPersonPhoto(person.key),
      birthDate: parseDateKey(person.birthDate),
      birthCity: person.birthCity,
      birthDepartment: person.birthDepartment,
      notes: demoPersonNotes(role),
    })
    if (role.shares) {
      shareholderRows.push({
        companyId: plan.id,
        type: 'PHYSICAL',
        personId,
        sharePercentage: round2((role.shares / plan.company.totalShares) * 100),
        numberOfShares: role.shares,
        capitalAmount: role.shares * plan.company.shareNominalValue,
      })
    }
  }
  if (personRows.length > 0) await prisma.person.createMany({ data: personRows })
  if (shareholderRows.length > 0) await prisma.shareholder.createMany({ data: shareholderRows })

  // Fiscal years 2025 and 2026, with the full PCG in both (the closing
  // copies 2025 accounts to 2026 and skips those that already exist).
  await prisma.fiscalYear.createMany({
    data: plans.flatMap((p) => [
      { id: p.fy2025, companyId: p.id, year: 2025, closingDay: 31, closingMonth: 12, startDate: parseDateKey('2025-01-01'), endDate: parseDateKey('2025-12-31') },
      { id: p.fy2026, companyId: p.id, year: 2026, closingDay: 31, closingMonth: 12, startDate: parseDateKey('2026-01-01'), endDate: parseDateKey('2026-12-31') },
    ]),
  })
  // The open year gets the full PCG; the closed 2025 only the accounts its
  // books use (and their parents): its reports, ledgers and FEC only list
  // accounts with movements, and it saves about a fifth of a sandbox's size.
  // The closing creates the result accounts it needs (ensureAccounts).
  log('Creating the charts of accounts')
  const accountRows: Prisma.AccountCreateManyInput[] = []
  for (const plan of plans) {
    const subAccounts = plan.profile.engine.spec.subAccounts ?? []
    // A sub-account's parent: its longest PCG prefix.
    const parentsOfSubAccounts = subAccounts.flatMap((a) => [...Array(a.code.length).keys()].map((n) => a.code.slice(0, n)))
    const used2025 = withParents([...plan.profile.engine.ledger(2025).flatMap((e) => e.lines.map((l) => l.account)), ...parentsOfSubAccounts])
    const chart2025 = chartOfAccounts(plan.id, plan.fy2025, used2025, subAccounts)
    const chart2026 = chartOfAccounts(plan.id, plan.fy2026, undefined, subAccounts)
    plan.accounts2025 = chart2025.ids
    plan.accounts2026 = chart2026.ids
    accountRows.push(...chart2025.rows, ...chart2026.rows)
  }
  await createInChunks(accountRows, 3000, (data) => prisma.account.createMany({ data }))
  await createReportConfigs(plans.map((p) => p.id))

  // ── 2025 ──
  log('Booking 2025')
  const rows2025 = plans.map((plan) =>
    ledgerRows({ id: plan.id, name: plan.company.name }, plan.fy2025, plan.accounts2025, plan.journals, plan.profile.engine.ledger(2025), 1)
  )
  // The intragroup invoices of each company, lettered with their payments
  // (before insertion: lettering stays free on validated entries anyway).
  const holdingIndex = plans.findIndex((p) => p.profile.engine.slug === HOLDING_SLUG)
  const holdingPlan = plans[holdingIndex]
  const groupBookings = new Map<string, GroupBooking>()
  const collectGroup = (year: number, rows: LedgerRows[], to: string) => {
    plans.forEach((plan, index) => {
      const accounts = year === 2025 ? plan.accounts2025 : plan.accounts2026
      collectGroupBookings(year, plan.profile.engine.slug, rows[index], accounts, plan.profile.engine.transactions(`${year}-01-01`, to), groupBookings)
    })
  }
  collectGroup(2025, rows2025, '2025-12-31')
  await insertLedger({
    entries: rows2025.flatMap((r) => r.entries),
    drafts: new Set(),
    lines: rows2025.flatMap((r) => r.lines),
    entryByTransaction: new Map(),
    entryByReference: new Map(),
  })

  // Balance sheet check before closing, then the app's closing service:
  // closing entries, transfer of the result, opening entries in 2026.
  // Companies are independent: closed concurrently to save round trips.
  // The accountant persona closes Lumen Holding's 2025 itself.
  const keepOpen = (plan: CompanyPlan) => accountant && plan.company.profile === ACCOUNTANT_OPEN_2025_PROFILE
  log(`Closing 2025 for ${plans.filter((p) => !keepOpen(p)).map((p) => p.company.name).join(', ')}`)
  await Promise.all(plans.map(async (plan, index) => {
    const balanceSheet = await generateBalanceSheet(plan.id, plan.fy2025, 'complete')
    const balance = validateBalanceSheetBalance(balanceSheet)
    if (!balance.isValid) log(`WARNING (${plan.company.name}): ${balance.error}`)
    plan.result.fiscalYear2025 = {
      ...plan.profile.engine.summary(2025),
      balanceSheetBalanced: balance.isValid,
      imbalance: balance.imbalance,
      balanceSheetTotal: round2(balanceSheet.actifTotal),
      closed: !keepOpen(plan),
    }
    plan.result.entries2025 = rows2025[index].entries.length
    if (keepOpen(plan)) return

    const closing = await closeFiscalYear(plan.id, plan.fy2025)
    if (!closing.success) {
      throw new Error(`Demo seed (${plan.company.name}): closing 2025 failed: ${(closing.errors ?? []).join(', ')}`)
    }
  }))

  // ── 2026, up to the cutoff ──
  log(`Booking 2026 up to ${cutoff}`)
  const existing2026 = await prisma.accountingEntry.groupBy({
    by: ['companyId'],
    where: { fiscalYearId: { in: plans.map((p) => p.fy2026) } },
    _count: { _all: true },
  })
  const rows2026 = plans.map((plan) => {
    const already = existing2026.find((e) => e.companyId === plan.id)?._count._all ?? 0
    const rows = ledgerRows(
      { id: plan.id, name: plan.company.name },
      plan.fy2026,
      plan.accounts2026,
      plan.journals,
      plan.profile.engine.ledger(2026, cutoff),
      already + 1,
      accountant ? demoDraftsFrom(cutoff) : undefined
    )
    plan.result.entries2026 = rows.entries.length
    plan.result.drafts2026 = rows.drafts.size
    return rows
  })
  collectGroup(2026, rows2026, cutoff)
  await insertLedger({
    entries: rows2026.flatMap((r) => r.entries),
    drafts: new Set(rows2026.flatMap((r) => [...r.drafts])),
    lines: rows2026.flatMap((r) => r.lines),
    entryByTransaction: new Map(),
    entryByReference: new Map(),
  })

  // Fixed assets (on the open year's accounts) and their 2025 depreciation.
  const assetRows: Prisma.FixedAssetCreateManyInput[] = []
  const depreciationRows: Prisma.FixedAssetDepreciationCreateManyInput[] = []
  for (const [index, plan] of plans.entries()) {
    for (const { asset, amount } of plan.profile.engine.depreciation(2025)) {
      const id = createId()
      const accountId = (code: string) => {
        const found = plan.accounts2026.get(code)
        if (!found) throw new Error(`Demo seed (${plan.company.name}): account ${code} missing in 2026`)
        return found
      }
      assetRows.push({
        id,
        companyId: plan.id,
        label: asset.label,
        comment: asset.comment,
        acquisitionDate: parseDateKey(asset.date),
        acquisitionValue: asset.amountHT,
        amortizableAmount: asset.amountHT,
        depreciationDuration: asset.durationYears,
        depreciationRate: round2(100 / asset.durationYears),
        depreciationMethod: 'linear',
        depreciationStartDate: parseDateKey(asset.date),
        assetAccountId: accountId(asset.account),
        depreciationAccountId: accountId(asset.depreciationAccount),
        expenseAccountId: accountId(asset.expenseAccount),
        isFullyPaid: true,
      })
      depreciationRows.push({
        companyId: plan.id,
        fixedAssetId: id,
        fiscalYearId: plan.fy2025,
        periodType: 'year',
        year: 2025,
        amount,
        accountingEntryId: rows2025[index].entryByReference.get(`AMORT-2025-${asset.account}`) ?? null,
        note: 'Dotation 2025',
      })
    }
  }
  if (assetRows.length > 0) {
    await prisma.fixedAsset.createMany({ data: assetRows })
    await prisma.fixedAssetDepreciation.createMany({ data: depreciationRows })
  }

  // Qonto integrations with the sandbox's own credentials, stored like
  // POST /api/integrations does (secret key encrypted).
  log('Connecting the simulated Qonto accounts')
  const credentials = new Map(plans.map((plan) => [plan.id, demoQontoCredentials(plan.profile, options.sandboxKey)]))
  await prisma.integration.createMany({
    data: plans.map((plan) => {
      const { login, secretKey } = credentials.get(plan.id)!
      return {
        id: plan.integrationId,
        companyId: plan.id,
        provider: 'QONTO' as const,
        type: 'BANKING' as const,
        name: 'Intégration QONTO',
        credentials: { login, secretKey: encrypt(secretKey, encryptionKey, integrationContext(plan.id, 'QONTO', 'secretKey')) },
        credentialsEncrypted: true,
        status: 'active',
      }
    }),
  })
  await prisma.integrationFeatureConfig.createMany({
    data: plans.flatMap((plan) => [
      { integrationId: plan.integrationId, feature: 'BANKING_ACCOUNTS' as const, enabled: true },
      { integrationId: plan.integrationId, feature: 'BANKING_TRANSACTIONS' as const, enabled: true },
    ]),
  })
  if (!getQontoApiUrl().includes(DEMO_QONTO_API_PATH)) {
    log(`WARNING: QONTO_API_URL (${getQontoApiUrl()}) does not point to the simulated API`)
  }
  log('Initial bank sync')
  await Promise.all(
    plans.map(async (plan) => {
      const sync = await syncIntegration(
        plan.integrationId,
        encryptionKey,
        [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS],
        {
          maxDays: DEMO_API_HISTORY_DAYS,
          now,
          provider: new InProcessDemoQontoProvider(credentials.get(plan.id)!, getQontoApiUrl(), now),
        }
      )
      if (!sync.success) log(`WARNING (${plan.company.name}): initial sync errors: ${sync.errors.join(' | ')}`)
    })
  )

  // The synced accounts: a readable name (Qonto's API names them by slug) and
  // the ledger account their entries are booked on (5121, euro accounts).
  await prisma.bankAccount.updateMany({
    where: { bankConnection: { companyId: { in: plans.map((p) => p.id) } }, currency: 'EUR' },
    data: { displayName: DEMO_BANK_ACCOUNT_DISPLAY_NAME, ledgerAccountCode: DEMO_BANK_LEDGER },
  })

  // Transactions already booked in the ledger are reconciled with their entry
  // (transaction ids are prefixed by company, so one statement covers all;
  // scoped to these companies, other copies keep their own state).
  const booked = [...rows2025, ...rows2026].flatMap((r) => [...r.entryByTransaction.entries()])
  const companyIds = plans.map((p) => p.id)
  await prisma.$executeRaw`
    UPDATE "bank_transactions" AS bt
    SET "reconciled" = true, "reconciledAt" = ${now}, "reconciledWith" = v.entry_id, "updatedAt" = ${now}
    FROM unnest(${booked.map(([tx]) => tx)}::text[], ${booked.map(([, entry]) => entry)}::text[]) AS v(external_id, entry_id),
         "bank_accounts" ba, "bank_connections" bc
    WHERE bt."externalTransactionId" = v.external_id
      AND ba."id" = bt."bankAccountId" AND bc."id" = ba."bankConnectionId"
      AND bc."companyId" = ANY(${companyIds}::text[])
  `
  const counts = await prisma.$queryRaw<Array<{ companyId: string; total: bigint; unreconciled: bigint }>>`
    SELECT bc."companyId" AS "companyId",
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE NOT bt."reconciled") AS unreconciled
    FROM "bank_transactions" bt
    JOIN "bank_accounts" ba ON ba."id" = bt."bankAccountId"
    JOIN "bank_connections" bc ON bc."id" = ba."bankConnectionId"
    WHERE bc."companyId" = ANY(${companyIds}::text[])
    GROUP BY bc."companyId"
  `
  for (const plan of plans) {
    const row = counts.find((c) => c.companyId === plan.id)
    plan.result.bankTransactionsSynced = Number(row?.total ?? 0)
    plan.result.bankTransactionsUnreconciled = Number(row?.unreconciled ?? 0)
  }

  // Transaction rules, same rows as POST /api/transaction-rules; not applied.
  // Every option is explicit (enabled, autoCreate, priority); requireApproval
  // is left to its default (unused by Kledg: rule entries are always drafts).
  log('Creating transaction rules')
  const ruleRows: Prisma.TransactionRuleCreateManyInput[] = []
  const conditionRows: Prisma.TransactionRuleConditionCreateManyInput[] = []
  const ruleLineRows: Prisma.TransactionRuleEntryLineCreateManyInput[] = []
  for (const plan of plans) {
    plan.company.rules.forEach((rule) => {
      const ruleId = createId()
      ruleRows.push({
        id: ruleId,
        companyId: plan.id,
        name: rule.name,
        description: rule.description,
        enabled: true,
        priority: rule.priority,
        journalCode: 'BQ',
        autoCreate: rule.autoCreate,
      })
      for (const c of rule.conditions) {
        conditionRows.push({ ruleId, conditionType: c.conditionType, operator: c.operator, value: c.value, value2: null })
      }
      rule.entryLines.forEach((line, order) => {
        ruleLineRows.push({ ruleId, order, vatOnDebit: false, vatAccount2Code: null, ...line, amountValue: line.amountValue ?? null })
      })
    })
  }
  await prisma.transactionRule.createMany({ data: ruleRows })
  await prisma.transactionRuleCondition.createMany({ data: conditionRows })
  await prisma.transactionRuleEntryLine.createMany({ data: ruleLineRows })

  // ── Management features: fees, budgets, expense reports ──
  // The fictional director (accountant and admin personas) prepared the
  // invoices and wrote her expense reports; in the director persona the
  // visitor plays her.
  const lumenIndex = plans.findIndex((p) => p.profile.engine.slug === 'atelier-lumen')
  const lumenPlan = plans[lumenIndex]
  const claireId = lumenPlan ? directorIds.get(lumenPlan.company.director.login) : undefined
  const party = (plan: CompanyPlan) => {
    const vatKey = (12 + 3 * (Number(plan.company.siren) % 97)) % 97
    return {
      slug: plan.profile.engine.slug,
      id: plan.id,
      name: plan.company.name,
      siren: plan.company.siren,
      vatNumber: plan.company.isVatExempt ? null : `FR${String(vatKey).padStart(2, '0')}${plan.company.siren}`,
    }
  }
  let group: GroupSeedResult | null = null
  if (holdingPlan && lumenPlan) {
    log('Intragroup invoices and management fees')
    group = await seedGroupInvoices({
      parties: new Map(plans.map((plan) => [plan.profile.engine.slug, party(plan)])),
      bookings: groupBookings,
      userId: user.id,
      createdById: claireId ?? user.id,
    })
  }

  log('Budgets 2026')
  const budgets = plans
    .filter((plan) => DEMO_BUDGETS[plan.profile.engine.slug])
    .map((plan) => ({ companyId: plan.id, fiscalYearId: plan.fy2026, lines: planBudget2026(plan.profile.engine, DEMO_BUDGETS[plan.profile.engine.slug]) }))
  await seedBudgets(budgets)

  let expenseReports: ExpenseReportSeedResult | null = null
  if (lumenPlan) {
    log('Expense reports')
    const reimbursement = lumenPlan.profile.engine.transactionsForDay(DIRECTOR_REIMBURSEMENT.date).find((t) => t.kind === 'expense_reimbursement')
    const rows = rows2026[lumenIndex]
    const reimbursementEntry = reimbursement ? rows.entryByTransaction.get(reimbursement.transactionId) : undefined
    const salaries = lumenPlan.accounts2026.get('421')
    const reimbursementLine =
      reimbursementEntry && !rows.drafts.has(reimbursementEntry)
        ? rows.lines.find((l) => l.accountingEntryId === reimbursementEntry && l.accountId === salaries)
        : undefined
    expenseReports = await seedDirectorExpenseReports({
      companyId: lumenPlan.id,
      claimantUserId: claireId ?? user.id,
      validatorUserId: user.id,
      cutoff,
      now,
      reimbursementLineId: reimbursementLine?.id ?? null,
    })
  }

  return {
    ledgerCutoff: cutoff,
    companies: plans.map((plan) => ({ companyId: plan.id, ...plan.result }) as DemoCompanySeedResult),
    features: { group, expenseReports, budgets: budgets.length },
  }
}
