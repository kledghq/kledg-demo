/**
 * Management features seeded in every demo sandbox (lib/demo/seed-features.ts),
 * against PostgreSQL (lib/__tests__/helpers/test-db.ts):
 * - management fees: Lumen Holding's convention with its two subsidiaries,
 *   one billing per subsidiary and booked month whose amounts are the pricing
 *   engine's, linked to the holding's VE sales invoice and the subsidiary's
 *   AC purchase invoice, paid and lettered; the months after the books are
 *   left to the visitor, who computes and invoices them through Kledg's routes;
 * - the group (lib/demo/qonto/profiles/group.ts): shareholders and people,
 *   intragroup invoices on both sides, and the group view and participations
 *   Kledg computes from them (director, admin and accountant personas);
 * - budgets: 2026 budgets of Atelier Lumen and Maison Verdier on class 6 and
 *   7 prefixes, close to 2025, with meaningful variances;
 * - expense reports: the president's claimant file and her three reports
 *   (reimbursed, submitted, draft), consistent with the bank;
 * - subscriptions detected from the synced bank lines;
 * - the same data in the accountant persona, where the accountant validates
 *   the submitted report through Kledg's route.
 *
 * Same mocks as sandbox.db.test.ts. Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('demo_features')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'https://demo.example.com'
  process.env.KLEDG_DEMO_MODE = 'true'
  process.env.QONTO_API_URL = 'https://demo.example.com/api/demo/qonto/v2'
  process.env.CRON_SECRET = 'cron-secret-for-tests'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': '198.51.100.41', 'user-agent': 'vitest' }),
  cookies: async () => ({ set: () => undefined }),
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { DESIGN_INVOICE, GROUP_STAKES, MANAGEMENT_FEE, VERDIER_ADVANCE, advanceInterest, feeInvoiceNumber, feeSubsidiary } from '../qonto/profiles/group'
import { DEMO_PERSON_ROLES } from '../people'
import { lumenDividend } from '../qonto/profiles/shared'
import { profileBySlug } from '../qonto/profiles'
import { DIRECTOR_CLAIMANT, DIRECTOR_REIMBURSEMENT, demoReportTotals, REIMBURSED_REPORT } from '../expense-reports'
import { DEMO_BUDGETS } from '../budgets'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: Prisma

interface Sandbox {
  userId: string
  email: string
  companies: Map<string, string>
}

async function provision(persona: 'director' | 'accountant' | 'admin', ip: string): Promise<Sandbox> {
  const { provisionSandbox } = await import('../sandbox/service')
  const result = await provisionSandbox({ ip, persona })
  if (!result.ok) throw new Error(`provisioning failed: ${result.reason}`)
  const companies = await prisma.company.findMany({
    where: { organization: { members: { some: { userId: result.userId } } } },
    select: { id: true, slug: true },
  })
  return { userId: result.userId, email: result.email, companies: new Map(companies.map((c) => [c.slug.replace(/-[a-z0-9]{6}$/, ''), c.id])) }
}

function as(sandbox: Sandbox) {
  state.user = { id: sandbox.userId, email: sandbox.email, name: 'Visiteur', role: 'user' }
}

async function call(route: () => Promise<unknown>, method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, body?: unknown) {
  const handler = ((await route()) as Record<string, Handler>)[method]
  const request = new NextRequest(`https://demo.example.com${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: 'https://demo.example.com' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve(params) })
}

const cents = (value: { toString(): string }) => Math.round(Number(value.toString()) * 100)

function cutoffOf(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 0)).toISOString().slice(0, 10)
}

/** The fee months booked in the ledger: every month of 2025, and 2026 up to the cutoff month. */
function bookedMonths(cutoff: string) {
  const months: Array<[number, number]> = []
  for (let m = 1; m <= 12; m++) months.push([2025, m])
  for (let m = 1; m <= Number(cutoff.slice(5, 7)); m++) months.push([2026, m])
  return months
}

let director: Sandbox
let accountant: Sandbox
let admin: Sandbox

describe.skipIf(!available)('management features of the demo sandboxes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('demo_features')
    ;({ prisma } = await import('@/lib/prisma'))
    director = await provision('director', '198.51.100.41')
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('management fees of Lumen Holding', () => {
    it('has the "Convention d\'animation" with both subsidiaries: a fixed monthly fee split 60 / 40, VAT 20 %, series LH', async () => {
      const holding = director.companies.get('lumen-holding')!
      const conventions = await prisma.managementFeeConvention.findMany({ where: { companyId: holding }, include: { subsidiaries: { orderBy: { position: 'asc' } } } })
      expect(conventions).toHaveLength(1)
      const [convention] = conventions
      expect(convention).toMatchObject({
        label: "Convention d'animation",
        pricing: 'FIXED',
        allocationKey: 'CUSTOM',
        vatRateBp: 2000,
        revenueAccountCode: '706',
        expenseAccountCode: '6226',
        invoicePrefix: 'LH',
      })
      expect(cents(convention.fixedAmount!)).toBe(MANAGEMENT_FEE.totalNet * 100)
      expect(convention.subsidiaries.map((s) => [s.subsidiaryId, s.sharePercentBp])).toEqual([
        [director.companies.get('atelier-lumen'), 6000],
        [director.companies.get('maison-verdier'), 4000],
      ])
    })

    it('bills every booked month of each subsidiary: engine amounts, sales invoice in the holding, purchase invoice in the subsidiary, both paid and lettered', async () => {
      const holding = director.companies.get('lumen-holding')!
      const cutoff = cutoffOf(new Date())
      const months = bookedMonths(cutoff)
      const billings = await prisma.managementFeeBilling.findMany({
        where: { companyId: holding },
        orderBy: { periodStart: 'asc' },
        include: {
          salesInvoice: {
            include: {
              vatBreakdown: true,
              payments: { include: { entryLine: { include: { account: true } } } },
              tiers: true,
              entry: { include: { lines: { include: { account: true } }, journal: true } },
            },
          },
          purchaseInvoice: {
            include: {
              payments: { include: { entryLine: { include: { account: true } } } },
              tiers: true,
              entry: { include: { lines: { include: { account: true } }, journal: true } },
            },
          },
        },
      })
      billings.sort((a, b) => (a.salesInvoice!.number ?? '').localeCompare(b.salesInvoice!.number ?? ''))
      const expected = months.flatMap(([y, m]) => MANAGEMENT_FEE.subsidiaries.map((sub) => feeInvoiceNumber(y, m, sub.slug)))
      expect(billings.map((b) => b.salesInvoice!.number)).toEqual(expected)

      // The pricing engine, through the service the preview route uses, gives the invoiced amounts.
      const { computeConventionFees } = await import('@/lib/management-fees/compute-management-fees.service')
      const { userGroupAccess } = await import('@/lib/management-fees/access')
      const access = userGroupAccess({ id: director.userId, email: director.email, name: null, role: 'user' })
      for (const billing of [billings[0], billings[27], billings[billings.length - 1]]) {
        const period = { periodStart: billing.periodStart.toISOString().slice(0, 10), periodEnd: billing.periodEnd.toISOString().slice(0, 10) }
        const { result } = await computeConventionFees(holding, billing.conventionId, period, access)
        const part = result.parts.find((p) => p.subsidiaryId === billing.subsidiaryId)!
        expect([cents(billing.amountExclTax), cents(billing.vatAmount), cents(billing.amountInclTax)]).toEqual([part.amountExclTaxCents, part.vatCents, part.amountInclTaxCents])
      }

      const slugOf = new Map([...director.companies.entries()].map(([slug, id]) => [id, slug]))
      for (const billing of billings) {
        const sub = feeSubsidiary(slugOf.get(billing.subsidiaryId)!)
        const net = sub.net * 100
        const sale = billing.salesInvoice!
        expect([cents(sale.totalExclTax), cents(sale.totalVat), cents(sale.totalInclTax)]).toEqual([net, net / 5, net * 1.2])
        expect(sale.tiers).toMatchObject({ name: sub.slug === 'atelier-lumen' ? 'Atelier Lumen' : 'Maison Verdier', kind: 'CUSTOMER' })
        expect(sale.issueDate.toISOString().slice(0, 10)).toBe(billing.periodStart.toISOString().slice(0, 10))
        // The VE entry is the invoice's: 411 (the subsidiary's auxiliary account) / 706 / 44571, VAT on debits.
        const entry = sale.entry!
        expect(entry.journal.code).toBe('VE')
        expect(entry.reference).toBe(sale.number)
        expect(entry.status).toBe('validated')
        const byCode = (lines: typeof entry.lines, code: string) => lines.find((l) => l.account.code === code)!
        expect([cents(byCode(entry.lines, '411').debit), byCode(entry.lines, '411').auxiliaryAccountNumber]).toEqual([net * 1.2, sale.tiers.auxiliaryAccountNumber])
        expect(cents(byCode(entry.lines, '706').credit)).toBe(net)
        // Paid by the transfer of the 25th, lettered with it.
        expect(sale.payments).toHaveLength(1)
        expect(sale.payments[0].entryLine.account.code).toBe('411')
        expect(sale.payments[0].entryLine.letteringCode).toBeTruthy()
        expect(sale.payments[0].entryLine.letteringCode).toBe(byCode(entry.lines, '411').letteringCode)

        // The subsidiary's side: the same invoice received, AC 6226 / 44566 / 401, paid and lettered.
        const purchase = billing.purchaseInvoice!
        expect(purchase).toMatchObject({ number: sale.number, direction: 'PURCHASE', companyId: billing.subsidiaryId })
        expect(purchase.tiers).toMatchObject({ name: 'Lumen Holding', kind: 'SUPPLIER', auxiliaryAccountNumber: 'F00001' })
        expect(cents(purchase.totalInclTax)).toBe(net * 1.2)
        const pEntry = purchase.entry!
        expect([pEntry.journal.code, pEntry.status]).toEqual(['AC', 'validated'])
        expect(cents(byCode(pEntry.lines, '6226').debit)).toBe(net)
        expect(cents(byCode(pEntry.lines, '44566').debit)).toBe(net / 5)
        expect(purchase.payments).toHaveLength(1)
        expect(purchase.payments[0].entryLine.account.code).toBe('401')
        expect(purchase.payments[0].entryLine.letteringCode).toBe(byCode(pEntry.lines, '401').letteringCode)
      }

      // Status as Kledg derives it: paid, on both sides.
      const { getInvoice } = await import('@/lib/invoices/manage-invoices.service')
      expect((await getInvoice(holding, billings[0].salesInvoiceId!)).status).toBe('paid')
      expect((await getInvoice(billings[1].subsidiaryId, billings[1].purchaseInvoiceId!)).status).toBe('paid')
    })

    it('leaves the months after the books to the visitor, who computes and invoices them through Kledg', async () => {
      as(director)
      const holding = director.companies.get('lumen-holding')!
      const convention = await prisma.managementFeeConvention.findFirstOrThrow({ where: { companyId: holding } })
      const cutoff = cutoffOf(new Date())
      const next = new Date(Date.UTC(Number(cutoff.slice(0, 4)), Number(cutoff.slice(5, 7)), 1))
      const periodStart = next.toISOString().slice(0, 10)
      const periodEnd = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
      const preview = await call(
        () => import('@/app/api/management-fees/conventions/[id]/preview/route'),
        'GET',
        `/api/management-fees/conventions/${convention.id}/preview?periodStart=${periodStart}&periodEnd=${periodEnd}`,
        { id: convention.id },
      )
      expect(preview.status).toBe(200)
      const computed = (await preview.json()) as { result: { totalExclTaxCents: number }; billed: unknown[] }
      expect(computed.result.totalExclTaxCents).toBe(MANAGEMENT_FEE.totalNet * 100)
      expect(computed.billed).toEqual([])

      const generated = await call(
        () => import('@/app/api/management-fees/conventions/[id]/invoices/route'),
        'POST',
        `/api/management-fees/conventions/${convention.id}/invoices`,
        { id: convention.id },
        { periodStart, periodEnd, issueDate: periodStart, purchaseDrafts: false },
      )
      expect(generated.status).toBe(201)
      const { billings } = (await generated.json()) as { billings: Array<{ salesInvoice: { number: string } }> }
      // The next numbers of the series are the ones the subsidiaries' transfers of that month refer to.
      const year = next.getUTCFullYear()
      const month = next.getUTCMonth() + 1
      expect(billings.map((b) => b.salesInvoice.number)).toEqual(MANAGEMENT_FEE.subsidiaries.map((sub) => feeInvoiceNumber(year, month, sub.slug)))
      for (const sub of MANAGEMENT_FEE.subsidiaries) {
        const transfer = profileBySlug(sub.slug).engine.transactions(periodStart, periodEnd).find((t) => t.kind === 'management_fees')
        if (transfer) expect(transfer.reference).toBe(feeInvoiceNumber(year, month, sub.slug))
      }
    })

    it('keeps the customer and supplier accounts lettered: no open 411 or 401 fee line on the validated months', async () => {
      const ids = [...director.companies.values()]
      const open = await prisma.entryLine.count({
        where: {
          account: { companyId: { in: ids }, code: { in: ['411', '401'] } },
          letteringCode: null,
          accountingEntry: { status: 'validated', fiscalYear: { year: 2025 }, journal: { code: { in: ['VE', 'AC'] } }, reference: { startsWith: 'LH-' } },
        },
      })
      expect(open).toBe(0)
    })
  })

  describe('the Lumen group', () => {
    const groupAccess = async (sandbox: Sandbox) => {
      const { userGroupAccess } = await import('@/lib/management-fees/access')
      return userGroupAccess({ id: sandbox.userId, email: sandbox.email, name: null, role: 'user' })
    }
    const fiscalYearOf = async (companyId: string, year: number) => (await prisma.fiscalYear.findFirstOrThrow({ where: { companyId, year } })).id

    it('records the holding among the shareholders of its subsidiaries and its participation, at the right percentages', async () => {
      const holding = director.companies.get('lumen-holding')!
      for (const stake of GROUP_STAKES) {
        const rows = await prisma.shareholder.findMany({ where: { companyId: director.companies.get(stake.slug), companyShareholderId: holding } })
        expect(rows.map((r) => [Number(r.sharePercentage), r.numberOfShares, Number(r.capitalAmount)])).toEqual([[stake.percent, stake.shares, stake.capitalHeld]])
      }
      const company = await prisma.company.findUniqueOrThrow({ where: { id: holding } })
      expect(Number(company.shareCapital)).toBe(240000)
    })

    it('gives the companies their fictional people: persons with a small photo, natural-person shareholders, officers', async () => {
      const ids = [...director.companies.values()]
      const persons = await prisma.person.findMany({ where: { companyId: { in: ids } }, include: { shareholders: true } })
      expect(persons).toHaveLength(DEMO_PERSON_ROLES.length)
      for (const person of persons) {
        expect(person.photo).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/)
        // Small: about 256 x 256 pixels, under 25 KB of image.
        expect(person.photo!.length).toBeGreaterThan(5000)
        expect(person.photo!.length).toBeLessThan(25_000 * 1.4)
        expect(person.email).toMatch(/\.example$/)
        expect(person.notes).toBeTruthy()
      }
      const slugOf = new Map([...director.companies.entries()].map(([slug, id]) => [id, slug]))
      for (const role of DEMO_PERSON_ROLES) {
        const [firstName] = role.person.split('-')
        const person = persons.find((p) => slugOf.get(p.companyId!) === role.company && p.firstName.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() === firstName)!
        expect(person, `${role.person} in ${role.company}`).toBeTruthy()
        if (role.shares) {
          expect(person.shareholders).toHaveLength(1)
          expect(person.shareholders[0]).toMatchObject({ companyId: person.companyId, type: 'PHYSICAL', numberOfShares: role.shares })
        } else {
          expect(person.shareholders).toHaveLength(0)
        }
      }
      // The holding: 100 % natural persons; the SCI: 60 % Hélène Garnier, 40 % the holding.
      const holdingRows = await prisma.shareholder.findMany({ where: { companyId: director.companies.get('lumen-holding') } })
      expect(holdingRows.every((r) => r.type === 'PHYSICAL')).toBe(true)
      expect(holdingRows.reduce((sum, r) => sum + Number(r.sharePercentage), 0)).toBe(100)
      const sciRows = await prisma.shareholder.findMany({ where: { companyId: director.companies.get('sci-les-tilleuls') } })
      expect(sciRows.reduce((sum, r) => sum + Number(r.sharePercentage), 0)).toBe(100)
    })

    it('records the other intragroup invoices on both sides: interest of the advance and the design job', async () => {
      const verdier = director.companies.get('maison-verdier')!
      const purchases = await prisma.invoice.findMany({ where: { companyId: verdier, direction: 'PURCHASE', NOT: { number: { startsWith: 'LH-' } } }, include: { tiers: true, payments: true }, orderBy: { issueDate: 'asc' } })
      expect(purchases.map((i) => [i.number, i.tiers.name, cents(i.totalExclTax)])).toEqual([
        [DESIGN_INVOICE.number, 'Atelier Lumen', DESIGN_INVOICE.net * 100],
        ['CC-2025-001', 'Lumen Holding', Math.round(advanceInterest(2025) * 100)],
      ])
      // Both paid: the design job in October, the interest in January.
      expect(purchases.map((i) => i.payments.length)).toEqual([1, 1])
      const sale = await prisma.invoice.findFirstOrThrow({ where: { companyId: director.companies.get('atelier-lumen'), number: DESIGN_INVOICE.number }, include: { payments: true } })
      expect(sale.direction).toBe('SALE')
      // VAT on receipt: the payment carries the entry moving the VAT from 44574 to 44571.
      expect(sale.payments[0].vatTransferEntryId).toBeTruthy()
      expect(sale.buyerSiren).toBe((await prisma.company.findUniqueOrThrow({ where: { id: verdier } })).siren)
    })

    it('shows the 2025 group view: combined figures, every flow found on both sides, eliminations without gap', async () => {
      const holding = director.companies.get('lumen-holding')!
      const { getGroupView } = await import('@/lib/group/get-group-view.service')
      const view = await getGroupView(holding, { fiscalYearId: await fiscalYearOf(holding, 2025) }, await groupAccess(director))
      const id = (slug: string) => director.companies.get(slug)!
      expect(view.unreachable).toEqual([])
      const members = view.members.map((m) => [m.name, m.role, m.ownershipBp, m.samePeriod, m.figures !== null])
      expect(members.sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
        ['Atelier Lumen', 'subsidiary', 10000, true, true],
        ['Lumen Holding', 'holding', null, true, true],
        ['Maison Verdier', 'subsidiary', 10000, true, true],
        ['SCI Les Tilleuls', 'subsidiary', 4000, true, true],
      ])
      expect(new Set(view.flows.map((f) => f.category))).toEqual(new Set(['management_fee', 'invoice', 'dividend', 'current_account', 'trade']))

      // Operations: both books agree.
      const pair = (seller: string, buyer: string) => view.eliminations.operations.find((p) => p.sellerId === id(seller) && p.buyerId === id(buyer))!
      const fees = (slug: string) => 12 * feeSubsidiary(slug).net * 100
      expect(pair('lumen-holding', 'atelier-lumen')).toMatchObject({ revenueCents: fees('atelier-lumen'), chargeCents: fees('atelier-lumen'), gapCents: 0 })
      const toVerdier = fees('maison-verdier') + Math.round(advanceInterest(2025) * 100)
      expect(pair('lumen-holding', 'maison-verdier')).toMatchObject({ revenueCents: toVerdier, chargeCents: toVerdier, gapCents: 0 })
      expect(pair('lumen-holding', 'maison-verdier').categories.sort()).toEqual(['invoice', 'management_fee'])
      expect(pair('atelier-lumen', 'maison-verdier')).toMatchObject({ revenueCents: DESIGN_INVOICE.net * 100, gapCents: 0, categories: ['invoice'] })
      // Dividends of Atelier Lumen, out of the combined result.
      expect(view.eliminations.dividends).toEqual([{ receiverId: id('lumen-holding'), payerId: id('atelier-lumen'), cents: lumenDividend(2025).amount * 100 }])
      // Balances: the advance (451100 / 455100) and the interest invoice still open (411 / 401).
      const balances = view.eliminations.balances
      expect(balances).toHaveLength(1)
      const open = (VERDIER_ADVANCE.amount + advanceInterest(2025)) * 100
      expect(balances[0]).toMatchObject({ creditorId: id('lumen-holding'), debtorId: id('maison-verdier'), receivableCents: Math.round(open), payableCents: Math.round(open), gapCents: 0 })
      expect(balances[0].categories.sort()).toEqual(['current_account', 'trade'])

      const operations = (fees('atelier-lumen') + fees('maison-verdier') + DESIGN_INVOICE.net * 100)
      expect(view.eliminations.effect.chiffreAffairesCents).toBe(-operations)
      expect(view.eliminations.effect.resultatCents).toBe(-lumenDividend(2025).amount * 100)
      expect(view.afterEliminations.totalBilanCents).toBe(view.combined.totalBilanCents - Math.round(open))
      expect(view.titresParticipationCents).toBe(240000 * 100)
      expect(view.warnings.some((w) => w.includes('écart') || w.includes('pas enregistré'))).toBe(false)
    })

    it('shows the 2026 group view without gap either', async () => {
      const holding = director.companies.get('lumen-holding')!
      const { getGroupView } = await import('@/lib/group/get-group-view.service')
      const view = await getGroupView(holding, { fiscalYearId: await fiscalYearOf(holding, 2026) }, await groupAccess(director))
      expect(view.members).toHaveLength(4)
      expect(view.eliminations.operations.length).toBeGreaterThanOrEqual(2)
      for (const p of view.eliminations.operations) expect(p.gapCents).toBe(0)
      for (const b of view.eliminations.balances) expect(b.gapCents).toBe(0)
      expect(view.eliminations.dividends.map((d) => d.cents)).toEqual([lumenDividend(2026).amount * 100])
    })

    it('lists the participations: categories, titres, quote-part, advances and dividends', async () => {
      const holding = director.companies.get('lumen-holding')!
      const { getParticipations } = await import('@/lib/group/get-participations.service')
      const report = await getParticipations(holding, { fiscalYearId: await fiscalYearOf(holding, 2025) }, await groupAccess(director))
      expect(report.unattributed).toEqual([])
      expect(report.unreachable).toEqual([])
      const row = (name: string) => report.rows.find((r) => r.name === name)!
      expect(row('Atelier Lumen')).toMatchObject({ kind: 'filiale', ownershipBp: 10000, numberOfShares: 100, bookValueGrossCents: 12000000, bookValueNetCents: 12000000, dividendsCents: 1500000, loansCents: 0 })
      expect(row('Maison Verdier')).toMatchObject({ kind: 'filiale', ownershipBp: 10000, numberOfShares: 500, bookValueGrossCents: 8400000, loansCents: VERDIER_ADVANCE.amount * 100, dividendsCents: 0 })
      expect(row('SCI Les Tilleuls')).toMatchObject({ kind: 'participation', ownershipBp: 4000, numberOfShares: 40, bookValueGrossCents: 3600000 })
      for (const r of report.rows) {
        expect(r.samePeriod).toBe(true)
        expect(r.capitauxPropresCents).not.toBeNull()
        expect(r.quotePartCents).toBe(Math.round((r.capitauxPropresCents! * r.ownershipBp) / 10000))
      }
      expect(row('Atelier Lumen').capitalCents).toBe(100000)
      expect(row('Maison Verdier').capitalCents).toBe(500000)
      expect(report.totals.bookValueGrossCents).toBe(24000000)
    })

    it('works for the admin persona, with the fictional managers as fellow members', async () => {
      admin = await provision('admin', '198.51.100.43')
      const holding = admin.companies.get('lumen-holding')!
      const { getGroupView } = await import('@/lib/group/get-group-view.service')
      const view = await getGroupView(holding, { fiscalYearId: await fiscalYearOf(holding, 2025) }, await groupAccess(admin))
      expect(view.unreachable).toEqual([])
      expect(view.members).toHaveLength(4)
      for (const p of view.eliminations.operations) expect(p.gapCents).toBe(0)
      for (const b of view.eliminations.balances) expect(b.gapCents).toBe(0)
      const { getParticipations } = await import('@/lib/group/get-participations.service')
      const report = await getParticipations(holding, { fiscalYearId: await fiscalYearOf(holding, 2025) }, await groupAccess(admin))
      expect(report.rows.map((r) => r.kind).sort()).toEqual(['filiale', 'filiale', 'participation'])
      const { deleteSandboxes } = await import('../sandbox/service')
      const ids = [...admin.companies.values()]
      await deleteSandboxes([{ id: admin.userId, email: admin.email }])
      // The fictional people go with the companies.
      expect(await prisma.person.count({ where: { companyId: { in: ids } } })).toBe(0)
    }, 120_000)
  })

  describe('budgets', () => {
    it('gives Atelier Lumen and Maison Verdier a 2026 budget on class 6 and 7 prefixes, none to the others', async () => {
      const budgets = await prisma.budget.findMany({
        where: { companyId: { in: [...director.companies.values()] } },
        include: { fiscalYear: true, lines: { include: { amounts: true, recurringItems: true } } },
      })
      const companyOf = new Map([...director.companies.entries()].map(([slug, id]) => [id, slug]))
      expect(budgets.map((b) => companyOf.get(b.companyId)).sort()).toEqual(['atelier-lumen', 'maison-verdier'])
      for (const budget of budgets) {
        expect(budget.fiscalYear.year).toBe(2026)
        const specs = DEMO_BUDGETS[companyOf.get(budget.companyId)!]
        expect(budget.lines.map((l) => l.accountPrefix).sort()).toEqual(specs.map((s) => s.prefix).sort())
        for (const line of budget.lines) {
          expect(line.accountPrefix).toMatch(/^[67][0-9]*$/)
          for (const amount of line.amounts) expect(amount.month).toMatch(/^2026-(0[1-9]|1[0-2])$/)
          expect(line.amounts.length + line.recurringItems.length).toBeGreaterThan(0)
        }
      }
      const lumen = budgets.find((b) => companyOf.get(b.companyId) === 'atelier-lumen')!
      expect(lumen.lines.flatMap((l) => l.recurringItems).length).toBeGreaterThanOrEqual(5)
    })

    it('stays close to the 2025 actuals and shows meaningful variances in the budget report', async () => {
      const lumen = director.companies.get('atelier-lumen')!
      const fy2026 = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: lumen, year: 2026 } })
      const { getBudgetReportOfFiscalYear } = await import('@/lib/budgets/get-budget-report.service')
      const { getBudget } = await import('@/lib/budgets/manage-budgets.service')
      const budget = await prisma.budget.findFirstOrThrow({ where: { companyId: lumen } })
      const detail = await getBudget(lumen, budget.id)
      const line = (prefix: string) => detail.lines.find((l) => l.accountPrefix === prefix)!
      // Recurring commitments: rent, management fees, payroll over twelve months.
      expect(line('6132').annualCents).toBe(12 * 125000)
      expect(line('6226').annualCents).toBe(12 * feeSubsidiary('atelier-lumen').net * 100)
      expect(line('64').annualCents).toBe(12 * 572000)
      // Sales planned 8 % above 2025.
      const sales2025 = profileBySlug('atelier-lumen').engine.summary(2025).revenue
      expect(line('706').annualCents / (sales2025 * 100)).toBeGreaterThan(1.05)
      expect(line('706').annualCents / (sales2025 * 100)).toBeLessThan(1.11)

      const throughMonth = cutoffOf(new Date()).slice(0, 7) as `${number}-${number}`
      const report = await getBudgetReportOfFiscalYear(lumen, fy2026.id, { throughMonth })
      const sales = report.produits.lines.find((r) => r.accountPrefix === '706')!
      const rent = report.charges.lines.find((r) => r.accountPrefix === '6132')!
      // Rent and management fees are booked as budgeted; sales and variable spending move around their budget.
      expect(rent.varianceCents).toBe(0)
      expect(report.charges.lines.find((r) => r.accountPrefix === '6226')!.varianceCents).toBe(0)
      expect(sales.actualCents).toBeGreaterThan(0)
      expect(sales.varianceCents).not.toBe(0)
      expect(Math.abs(sales.variancePercent!)).toBeLessThan(50)
      expect(report.charges.lines.filter((r) => r.varianceCents !== 0).length).toBeGreaterThanOrEqual(3)
      // Unbudgeted accounts (books, depreciation) show apart.
      expect(report.charges.unbudgeted.map((r) => r.accountPrefix)).toContain('6181')
      expect(report.resultat.actualCents).toBe(report.produits.total.actualCents - report.charges.total.actualCents)
    })
  })

  describe('expense reports of Atelier Lumen', () => {
    it('has the president as claimant (dirigeant on 421, D00001), the visitor who plays her', async () => {
      const lumen = director.companies.get('atelier-lumen')!
      const claimants = await prisma.expenseClaimant.findMany({ where: { companyId: lumen } })
      expect(claimants).toHaveLength(1)
      expect(claimants[0]).toMatchObject({ ...DIRECTOR_CLAIMANT, userId: director.userId })
    })

    it('has three reports: reimbursed, submitted and draft, consistent with the bank', async () => {
      const lumen = director.companies.get('atelier-lumen')!
      const { listExpenseReports } = await import('@/lib/expense-reports/manage-expense-reports.service')
      const { items } = (await listExpenseReports(lumen, { userId: director.userId, canManage: true }, {
        status: 'all',
        mine: false,
        limit: 50,
      })) as unknown as { items: Array<{ number: string; status: string; totalInclTaxCents: number; entry: { status: string } | null }> }
      const byNumber = new Map(items.map((r) => [r.number, r]))
      expect([...byNumber.keys()].sort()).toEqual(['NDF-0001', 'NDF-0002', 'NDF-0003'])
      expect(byNumber.get('NDF-0001')!.status).toBe('reimbursed')
      expect(byNumber.get('NDF-0001')!.entry!.status).toBe('validated')
      expect(byNumber.get('NDF-0002')!.status).toBe('submitted')
      expect(byNumber.get('NDF-0003')!.status).toBe('draft')

      // The reimbursement transfer of the bank is what NDF-0001 owes.
      const total = demoReportTotals(REIMBURSED_REPORT).totalInclTaxCents
      expect(byNumber.get('NDF-0001')!.totalInclTaxCents).toBe(total)
      const transfer = profileBySlug('atelier-lumen').engine.transactionsForDay(DIRECTOR_REIMBURSEMENT.date).find((t) => t.kind === 'expense_reimbursement')!
      expect(Math.round(transfer.amount * 100)).toBe(total)
      expect(transfer.booking).toEqual([{ account: '421', debit: transfer.amount }])

      // Lettered together: the report's 421 credit and the transfer's 421 debit.
      const report = await prisma.expenseReport.findFirstOrThrow({ where: { companyId: lumen, number: 'NDF-0001' } })
      const claimantLine = await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: report.entryId!, auxiliaryAccountNumber: 'D00001' } })
      const group = await prisma.entryLine.findMany({ where: { accountId: claimantLine.accountId, letteringCode: claimantLine.letteringCode } })
      expect(group).toHaveLength(2)
      expect(group.reduce((sum, l) => sum + cents(l.debit) - cents(l.credit), 0)).toBe(0)
    })
  })

  describe('subscriptions', () => {
    it('detects the software, telecom and hosting of Atelier Lumen as subscriptions, payroll and loans as recurring charges', async () => {
      const { listDetectedSubscriptions } = await import('@/lib/subscriptions/detect-subscriptions.service')
      const lumen = await listDetectedSubscriptions(director.companies.get('atelier-lumen')!)
      const kindOf = (name: string) => lumen.items.find((s) => s.name === name)
      for (const name of ['Logiciel de facturation', 'Suite de création graphique', 'Hébergement web', 'Opérateur mobile', "Fournisseur d'accès internet"]) {
        expect(kindOf(name), name).toMatchObject({ kind: 'subscription', cadence: 'monthly', status: 'active' })
      }
      expect(kindOf('Président')).toMatchObject({ kind: 'recurring_charge', chargeReason: 'personnel' })
      expect(kindOf('URSSAF')).toMatchObject({ kind: 'recurring_charge', chargeReason: 'social' })
      // The management fees of the holding recur monthly, at the convention's price.
      expect(kindOf('Lumen Holding')).toMatchObject({ cadence: 'monthly', typicalAmountCents: 180000 })
      // Customers' payments are never subscriptions.
      expect(lumen.items.some((s) => s.name === 'Maison Verlaine')).toBe(false)
      expect(lumen.totals.activeCount).toBeGreaterThanOrEqual(5)

      const sci = await listDetectedSubscriptions(director.companies.get('sci-les-tilleuls')!)
      expect(sci.items.find((s) => s.name === 'Prêt immobilier')).toMatchObject({ kind: 'recurring_charge', chargeReason: 'loans' })
    })
  })

  describe('accountant persona', () => {
    beforeAll(async () => {
      accountant = await provision('accountant', '198.51.100.42')
    }, 120_000)

    it('seeds the same features, the reports written by the fictional president, and lets the accountant validate NDF-0002', async () => {
      const lumen = accountant.companies.get('atelier-lumen')!
      const holding = accountant.companies.get('lumen-holding')!
      const claimant = await prisma.expenseClaimant.findFirstOrThrow({ where: { companyId: lumen }, include: { user: true } })
      expect(claimant.user?.name).toBe('Claire Vasseur')
      expect(claimant.userId).not.toBe(accountant.userId)
      expect(await prisma.managementFeeBilling.count({ where: { companyId: holding } })).toBe(2 * bookedMonths(cutoffOf(new Date())).length)
      expect(await prisma.budget.count({ where: { companyId: { in: [...accountant.companies.values()] } } })).toBe(2)

      // The transfer of the last booked month is a draft for the accountant: its invoice waits for the payment.
      const lastNumber = feeInvoiceNumber(2026, Number(cutoffOf(new Date()).slice(5, 7)), 'atelier-lumen')
      const last = await prisma.invoice.findFirstOrThrow({ where: { companyId: holding, number: lastNumber }, include: { payments: true } })
      expect(last.payments).toHaveLength(0)

      as(accountant)
      const submitted = await prisma.expenseReport.findFirstOrThrow({ where: { companyId: lumen, number: 'NDF-0002' } })
      const response = await call(() => import('@/app/api/expense-reports/[id]/workflow/route'), 'POST', `/api/expense-reports/${submitted.id}/workflow`, { id: submitted.id }, { action: 'validate' })
      expect(response.status).toBe(200)
      expect((await prisma.expenseReport.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe('VALIDATED')
    })

    it('shows the group view of the holding\'s 2025, still open, to the accountant: same flows, no gap', async () => {
      const holding = accountant.companies.get('lumen-holding')!
      const fy2025 = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: holding, year: 2025 } })
      expect(fy2025.isClosed).toBe(false)
      const { userGroupAccess } = await import('@/lib/management-fees/access')
      const access = userGroupAccess({ id: accountant.userId, email: accountant.email, name: null, role: 'user' })
      const { getGroupView } = await import('@/lib/group/get-group-view.service')
      const view = await getGroupView(holding, { fiscalYearId: fy2025.id }, access)
      expect(view.unreachable).toEqual([])
      expect(view.members).toHaveLength(4)
      expect(view.eliminations.operations).toHaveLength(3)
      for (const p of view.eliminations.operations) expect(p.gapCents).toBe(0)
      for (const b of view.eliminations.balances) expect(b.gapCents).toBe(0)
      const { getParticipations } = await import('@/lib/group/get-participations.service')
      const report = await getParticipations(holding, { fiscalYearId: fy2025.id }, access)
      expect(report.rows).toHaveLength(3)
      expect(report.unattributed).toEqual([])
    })
  })

  it('deletes a sandbox with its fees, invoices, budgets and expense reports', async () => {
    const { deleteSandboxes } = await import('../sandbox/service')
    const ids = [...director.companies.values()]
    await deleteSandboxes([{ id: director.userId, email: director.email }])
    expect(await prisma.company.count({ where: { id: { in: ids } } })).toBe(0)
    expect(await prisma.managementFeeConvention.count({ where: { companyId: { in: ids } } })).toBe(0)
    expect(await prisma.invoice.count({ where: { companyId: { in: ids } } })).toBe(0)
    expect(await prisma.budget.count({ where: { companyId: { in: ids } } })).toBe(0)
    expect(await prisma.expenseReport.count({ where: { companyId: { in: ids } } })).toBe(0)
    expect(await prisma.expenseClaimant.count({ where: { companyId: { in: ids } } })).toBe(0)
    // The other sandbox keeps its data.
    expect(await prisma.managementFeeBilling.count({ where: { companyId: accountant.companies.get('lumen-holding') } })).toBeGreaterThan(12)
  })
})
