/**
 * Management features seeded in every demo sandbox (lib/demo/seed-features.ts),
 * against PostgreSQL (lib/__tests__/helpers/test-db.ts):
 * - management fees: Lumen Holding's convention, one invoice and billing per
 *   booked month whose amounts are the pricing engine's, linked to the VE
 *   entries, paid and lettered; the months after the books are left to the
 *   visitor, who computes and invoices them through Kledg's routes;
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
import { lumenFeeInvoiceNumber, LUMEN_MANAGEMENT_FEE } from '../qonto/profiles/shared'
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

async function provision(persona: 'director' | 'accountant', ip: string): Promise<Sandbox> {
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
    it('has the "Convention d\'animation" with Atelier Lumen: a fixed monthly fee, VAT 20 %, series LH', async () => {
      const holding = director.companies.get('lumen-holding')!
      const conventions = await prisma.managementFeeConvention.findMany({ where: { companyId: holding }, include: { subsidiaries: true } })
      expect(conventions).toHaveLength(1)
      const [convention] = conventions
      expect(convention).toMatchObject({
        label: "Convention d'animation",
        pricing: 'FIXED',
        allocationKey: 'EQUAL',
        vatRateBp: 2000,
        revenueAccountCode: '706',
        expenseAccountCode: '6226',
        invoicePrefix: 'LH',
      })
      expect(cents(convention.fixedAmount!)).toBe(LUMEN_MANAGEMENT_FEE.net * 100)
      expect(convention.subsidiaries.map((s) => s.subsidiaryId)).toEqual([director.companies.get('atelier-lumen')])
      // The holding is a shareholder of the subsidiary: the nav entry shows.
      expect(await prisma.shareholder.count({ where: { companyId: director.companies.get('atelier-lumen'), companyShareholderId: holding } })).toBe(1)
    })

    it('invoices every booked month: billing amounts equal the engine computation, invoices linked to their VE entry, paid and lettered', async () => {
      const holding = director.companies.get('lumen-holding')!
      const cutoff = cutoffOf(new Date())
      const months = bookedMonths(cutoff)
      const billings = await prisma.managementFeeBilling.findMany({
        where: { companyId: holding },
        orderBy: { periodStart: 'asc' },
        include: {
          salesInvoice: {
            include: {
              lines: true,
              vatBreakdown: true,
              payments: { include: { entryLine: { include: { accountingEntry: true, account: true } } } },
              tiers: true,
              entry: { include: { lines: { include: { account: true } }, journal: true } },
            },
          },
        },
      })
      expect(billings.map((b) => b.salesInvoice!.number)).toEqual(months.map(([y, m]) => lumenFeeInvoiceNumber(y, m)))

      // The pricing engine, through the service the preview route uses, gives the invoiced amounts.
      const { computeConventionFees } = await import('@/lib/management-fees/compute-management-fees.service')
      const { userGroupAccess } = await import('@/lib/management-fees/access')
      const access = userGroupAccess({ id: director.userId, email: director.email, name: null, role: 'user' })
      for (const billing of [billings[0], billings[13], billings[billings.length - 1]]) {
        const period = { periodStart: billing.periodStart.toISOString().slice(0, 10), periodEnd: billing.periodEnd.toISOString().slice(0, 10) }
        const { result } = await computeConventionFees(holding, billing.conventionId, period, access)
        expect([cents(billing.amountExclTax), cents(billing.vatAmount), cents(billing.amountInclTax)]).toEqual([
          result.parts[0].amountExclTaxCents,
          result.parts[0].vatCents,
          result.parts[0].amountInclTaxCents,
        ])
      }

      for (const billing of billings) {
        const invoice = billing.salesInvoice!
        expect([cents(invoice.totalExclTax), cents(invoice.totalVat), cents(invoice.totalInclTax)]).toEqual([150000, 30000, 180000])
        expect(cents(billing.amountInclTax)).toBe(cents(invoice.totalInclTax))
        expect(invoice.tiers).toMatchObject({ name: 'Atelier Lumen', auxiliaryAccountNumber: LUMEN_MANAGEMENT_FEE.customerAux, kind: 'CUSTOMER' })
        expect(invoice.issueDate.toISOString().slice(0, 10)).toBe(billing.periodStart.toISOString().slice(0, 10))
        expect(invoice.vatBreakdown.map((v) => [v.vatRateBp, cents(v.baseAmount), cents(v.vatAmount)])).toEqual([[2000, 150000, 30000]])
        // The VE entry is the invoice's: 411 (auxiliary C00001) / 706 / 44571, VAT on debits.
        const entry = invoice.entry!
        expect(entry.journal.code).toBe('VE')
        expect(entry.reference).toBe(invoice.number)
        expect(entry.status).toBe('validated')
        const byCode = (code: string) => entry.lines.find((l) => l.account.code === code)!
        expect([cents(byCode('411').debit), byCode('411').auxiliaryAccountNumber]).toEqual([180000, 'C00001'])
        expect(cents(byCode('706').credit)).toBe(150000)
        expect(cents(byCode('44571').credit)).toBe(30000)
        // Paid by the transfer of the 25th, lettered with it.
        expect(invoice.payments).toHaveLength(1)
        const payment = invoice.payments[0]
        expect(cents(payment.amount)).toBe(180000)
        expect(payment.entryLine.account.code).toBe('411')
        expect(payment.entryLine.letteringCode).toBeTruthy()
        expect(payment.entryLine.letteringCode).toBe(byCode('411').letteringCode)
      }

      // Status as Kledg derives it: paid.
      const { getInvoice } = await import('@/lib/invoices/manage-invoices.service')
      expect((await getInvoice(holding, billings[0].salesInvoiceId!)).status).toBe('paid')
      expect((await getInvoice(holding, billings[billings.length - 1].salesInvoiceId!)).status).toBe('paid')
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
      expect(computed.result.totalExclTaxCents).toBe(150000)
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
      // The next number of the series is the one Atelier Lumen's transfer of that month refers to.
      expect(billings[0].salesInvoice.number).toBe(lumenFeeInvoiceNumber(next.getUTCFullYear(), next.getUTCMonth() + 1))
      const lumenTransfer = profileBySlug('atelier-lumen').engine.transactions(periodStart, periodEnd).find((t) => t.kind === 'management_fees')
      if (lumenTransfer) expect(lumenTransfer.reference).toBe(billings[0].salesInvoice.number)
    })

    it('keeps the holding customer account lettered: no open 411 line on the validated months', async () => {
      const holding = director.companies.get('lumen-holding')!
      const open = await prisma.entryLine.count({
        where: { account: { companyId: holding, code: '411' }, letteringCode: null, accountingEntry: { status: 'validated', fiscalYear: { year: 2025 } } },
      })
      expect(open).toBe(0)
    })
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
      expect(line('6226').annualCents).toBe(12 * LUMEN_MANAGEMENT_FEE.net * 100)
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
      expect(await prisma.managementFeeBilling.count({ where: { companyId: holding } })).toBe(bookedMonths(cutoffOf(new Date())).length)
      expect(await prisma.budget.count({ where: { companyId: { in: [...accountant.companies.values()] } } })).toBe(2)

      // The transfer of the last booked month is a draft for the accountant: its invoice waits for the payment.
      const lastNumber = lumenFeeInvoiceNumber(2026, Number(cutoffOf(new Date()).slice(5, 7)))
      const last = await prisma.invoice.findFirstOrThrow({ where: { companyId: holding, number: lastNumber }, include: { payments: true } })
      expect(last.payments).toHaveLength(0)

      as(accountant)
      const submitted = await prisma.expenseReport.findFirstOrThrow({ where: { companyId: lumen, number: 'NDF-0002' } })
      const response = await call(() => import('@/app/api/expense-reports/[id]/workflow/route'), 'POST', `/api/expense-reports/${submitted.id}/workflow`, { id: submitted.id }, { action: 'validate' })
      expect(response.status).toBe(200)
      expect((await prisma.expenseReport.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe('VALIDATED')
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
