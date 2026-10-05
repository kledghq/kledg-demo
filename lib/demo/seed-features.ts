/**
 * Demo seed of Kledg's management features (called by lib/demo/seed.ts once
 * the books are written), with the same data in every sandbox and persona:
 *
 * - The group (lib/demo/qonto/profiles/group.ts): the books already carry
 *   the intragroup invoices (management fees of the holding to both
 *   subsidiaries, interest of the current-account advance, Atelier Lumen's
 *   design job for Maison Verdier) on both sides and the transfers that
 *   settle them. Each booked one becomes an invoice of Kledg's invoice
 *   module in both companies, linked to its entry, paid and lettered once
 *   the transfer is booked and validated; Lumen Holding's "Convention
 *   d'animation", created by the conventions service, gets a management fee
 *   billing per subsidiary and booked month whose amounts come from the
 *   pricing engine (lib/management-fees/compute.ts). The months after the
 *   books (the last elapsed one and the current one) are left for the
 *   visitor to compute and invoice.
 * - Budgets (lib/budgets, planned in lib/demo/budgets.ts): the 2026 budgets of Atelier Lumen and Maison
 *   Verdier, monthly amounts from their 2025 actuals with a growth factor
 *   per line, and recurring items (rent, insurance, software, payroll,
 *   management fees, CFE).
 * - Expense reports (lib/expense-reports): the president of Atelier Lumen
 *   and her three reports (lib/demo/expense-reports.ts), through the expense
 *   report, posting, entry and lettering services.
 *
 * Subscriptions (lib/subscriptions) need nothing: they are detected from
 * the synced bank lines at each read.
 *
 * Writes are batched (createMany) except where a Kledg service owns an
 * invariant that is cheap to go through (six tiers, one convention, one
 * claimant, three reports).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { dayToDate } from '@/lib/accounting/entry-date'
import { validateEntries } from '@/lib/accounting/services/entry-lifecycle.service'
import { createId } from '@/lib/crypto/ids'
import { createClaimant } from '@/lib/expense-reports/manage-expense-claimants.service'
import { CreateExpenseReportBodySchema, createExpenseReport, runExpenseWorkflow } from '@/lib/expense-reports/manage-expense-reports.service'
import { mileageScaleOf } from '@/lib/expense-reports/mileage-scale'
import { postExpenseReport } from '@/lib/expense-reports/post-expense-report.service'
import type { ExpenseActor } from '@/lib/expense-reports/actor'
import { computeInvoiceTotals } from '@/lib/invoices/amounts'
import { letterLines } from '@/lib/lettering/lettering.service'
import { successorCode } from '@/lib/lettering/rules'
import { userGroupAccess } from '@/lib/management-fees/access'
import { computeManagementFees, type ComputeResult } from '@/lib/management-fees/compute'
import { ConventionBodySchema, createConvention, type Convention } from '@/lib/management-fees/manage-conventions.service'
import { DEFAULT_PAYMENT_TERMS, dueDateOf } from '@/lib/reports/third-parties/payment-terms'
import { createTiers } from '@/lib/tiers/manage-tiers.service'
import { centsToDecimal } from '@/lib/utils/money'
import { DIRECTOR_CLAIMANT, DIRECTOR_REIMBURSEMENT, REIMBURSED_REPORT, draftReport, submittedReport, type DemoExpenseReport } from './expense-reports'
import type { DemoTransaction } from './qonto/engine'
import type { PlannedBudgetLine } from './budgets'
import {
  GROUP_TIERS,
  HOLDING_SLUG,
  MANAGEMENT_FEE,
  grossOf,
  invoicesOf,
  vatTransferReference,
  type GroupInvoice,
} from './qonto/profiles/group'

/** The ledger rows the seed prepares for one company and one fiscal year (lib/demo/seed.ts LedgerRows). */
export interface SeedLedgerRows {
  drafts: Set<string>
  lines: Prisma.EntryLineCreateManyInput[]
  entryByTransaction: Map<string, string>
  entryByReference: Map<string, string>
}

const SOURCE = 'demo-seed'

// ── Group: intragroup invoices, management fees ────────────────────────────

/** An intragroup invoice as one company booked it (its entry) and, once booked, paid it. */
export interface GroupBooking {
  slug: string
  invoice: GroupInvoice
  side: 'SALE' | 'PURCHASE'
  entryId: string
  /** The 411 or 401 line of the invoice entry. */
  tiersLineId: string
  /** The 411 or 401 line of the transfer that settles it, when booked in a validated entry. */
  paymentLineId: string | null
  /** The OD entry moving the VAT on receipt to 44571 (sale with VAT on receipts). */
  vatTransferEntryId: string | null
  lettered: boolean
}

const bookingKey = (slug: string, number: string) => `${slug}\u0000${number}`

/**
 * Finds, in one company's ledger rows of a year, the intragroup invoices it
 * booked (issued that year) and the transfers that settle them (paid that
 * year), and letters each invoice with its transfer on the customer (411) or
 * supplier (401) account, as Kledg's lettering would (one code per invoice,
 * AA, AB..., dated on the payment), when both entries are validated and in
 * the same fiscal year: a draft (the accountant persona's last weeks) or an
 * invoice paid the next year stays unlettered. Mutates the line rows before
 * they are inserted; records what it found in `bookings`.
 */
export function collectGroupBookings(
  year: number,
  slug: string,
  rows: SeedLedgerRows,
  accounts: Map<string, string>,
  transactions: readonly DemoTransaction[],
  bookings: Map<string, GroupBooking>,
): void {
  const tiersAccountOf = (side: GroupBooking['side']) => accounts.get(side === 'SALE' ? '411' : '401')
  const lineOf = (entryId: string | undefined, accountId: string | undefined) =>
    entryId && accountId ? rows.lines.find((l) => l.accountingEntryId === entryId && l.accountId === accountId) : undefined

  for (const invoice of invoicesOf(slug, year)) {
    const entryId = rows.entryByReference.get(invoice.number)
    if (!entryId) continue
    const side: GroupBooking['side'] = invoice.seller === slug ? 'SALE' : 'PURCHASE'
    const line = lineOf(entryId, tiersAccountOf(side))
    if (!line?.id) throw new Error(`Demo seed: invoice ${invoice.number} of ${slug} has no ${side === 'SALE' ? '411' : '401'} line`)
    bookings.set(bookingKey(slug, invoice.number), {
      slug, invoice, side, entryId, tiersLineId: line.id, paymentLineId: null, vatTransferEntryId: null, lettered: false,
    })
  }

  const codes = new Map<string, string>()
  const settlements = transactions.filter((t) => (t.kind === 'management_fees' || t.kind === 'intragroup_invoice') && t.reference)
  for (const transaction of settlements) {
    const booking = bookings.get(bookingKey(slug, transaction.reference as string))
    if (!booking) continue
    const paymentEntryId = rows.entryByTransaction.get(transaction.transactionId)
    if (!paymentEntryId || rows.drafts.has(paymentEntryId)) continue
    const accountId = tiersAccountOf(booking.side)
    const paymentLine = lineOf(paymentEntryId, accountId)
    if (!paymentLine?.id || !accountId) continue
    booking.paymentLineId = paymentLine.id
    if (booking.side === 'SALE' && booking.invoice.sellerVatOnReceipts) {
      booking.vatTransferEntryId = rows.entryByReference.get(vatTransferReference(booking.invoice.number)) ?? null
    }
    const invoiceLine = rows.lines.find((l) => l.id === booking.tiersLineId)
    if (!invoiceLine || rows.drafts.has(booking.entryId)) continue
    const previous = codes.get(accountId)
    const code = previous ? successorCode(previous) : 'AA'
    codes.set(accountId, code)
    for (const line of [invoiceLine, paymentLine]) {
      line.letteringCode = code
      line.letteringDate = dayToDate(transaction.date)
    }
    booking.lettered = true
  }
}

export interface GroupParty {
  slug: string
  id: string
  name: string
  siren: string
  vatNumber: string | null
}

/** What a billing records of its computation (bill-management-fees.service.ts billingDetails), amounts in cents. */
function billingDetails(convention: Convention, result: ComputeResult, subsidiaryId: string) {
  const part = result.parts.find((p) => p.subsidiaryId === subsidiaryId)
  return {
    pricing: result.pricing,
    allocationKey: result.allocationKey,
    costPoolCents: result.costPoolCents,
    costShareBp: result.costShareBp,
    markupBp: result.markupBp,
    baseCents: result.baseCents,
    markupCents: result.markupCents,
    totalExclTaxCents: result.totalExclTaxCents,
    costAccounts: [],
    costAccountPrefixes: convention.costAccountPrefixes,
    excludedAccountPrefixes: convention.excludedAccountPrefixes,
    weights: result.parts.map((p) => ({ subsidiaryId: p.subsidiaryId, weight: p.weight, eligibleDays: p.eligibleDays, revenueCents: p.revenueCents, sharePercentBp: p.sharePercentBp })),
    part: part ? { weight: part.weight, eligibleDays: part.eligibleDays, revenueCents: part.revenueCents } : null,
  }
}

export interface GroupSeedResult {
  conventionId: string
  /** Invoices recorded, both sides. */
  invoices: number
  billings: number
  payments: number
}

/**
 * The group's documents on top of the books: the tiers each company keeps
 * for the others (with the sandbox's SIREN numbers), the holding's "Convention
 * d'animation" with both subsidiaries, every booked intragroup invoice on
 * both sides (sales and purchase invoices of Kledg's invoice module linked to
 * their entries, with their payments), and a management fee billing per
 * subsidiary and booked month linking the holding's sales invoice and the
 * subsidiary's purchase invoice. Throws when the pricing engine disagrees
 * with the booked amounts: the books and the invoices must say the same thing.
 */
export async function seedGroupInvoices(input: {
  parties: ReadonlyMap<string, GroupParty>
  bookings: ReadonlyMap<string, GroupBooking>
  /** The visitor: reads every company (the convention service checks reports:read in the subsidiaries). */
  userId: string
  /** Who prepared the invoices: the fictional director when there is one, else the visitor. */
  createdById: string
}): Promise<GroupSeedResult> {
  const party = (slug: string) => {
    const found = input.parties.get(slug)
    if (!found) throw new Error(`Demo seed: ${slug} missing from the group`)
    return found
  }
  const holding = party(HOLDING_SLUG)

  // Tiers, with the auxiliary accounts the generated books use.
  const tiersIds = new Map<string, string>()
  for (const t of GROUP_TIERS) {
    const books = party(t.books)
    const counterpart = party(t.counterpart)
    const tiers = await createTiers(
      books.id,
      {
        kind: t.kind,
        name: counterpart.name,
        siren: counterpart.siren,
        vatNumber: counterpart.vatNumber,
        auxiliaryAccountNumber: t.aux,
        notes: t.counterpart === HOLDING_SLUG ? 'Holding du groupe' : t.books === HOLDING_SLUG ? 'Filiale à 100 %' : 'Société du groupe Lumen',
      },
      { source: SOURCE },
    )
    if (tiers.auxiliaryAccountNumber !== t.aux) throw new Error(`Demo seed: ${counterpart.name} got ${tiers.auxiliaryAccountNumber} in ${books.name}, the books use ${t.aux}`)
    tiersIds.set(`${t.books}\u0000${t.counterpart}`, tiers.id)
  }

  const access = userGroupAccess({ id: input.userId, email: '', name: null, role: 'user' })
  const convention = await createConvention(
    holding.id,
    ConventionBodySchema.parse({
      label: MANAGEMENT_FEE.convention,
      pricing: 'FIXED',
      fixedAmountCents: MANAGEMENT_FEE.totalNet * 100,
      allocationKey: 'CUSTOM',
      vatRateBp: MANAGEMENT_FEE.vatRate * 100,
      revenueAccountCode: '706',
      expenseAccountCode: '6226',
      invoicePrefix: MANAGEMENT_FEE.invoicePrefix,
      startDate: '2025-01-01',
      notes:
        'Direction générale, animation commerciale et gestion administrative et financière d’Atelier Lumen et de Maison Verdier. Forfait mensuel de 2 500 € HT réparti à 60 % pour Atelier Lumen et 40 % pour Maison Verdier, facturé le premier jour du mois et réglé le 25. TVA sur les débits.',
      subsidiaries: MANAGEMENT_FEE.subsidiaries.map((sub) => ({ subsidiaryId: party(sub.slug).id, sharePercentBp: sub.sharePercentBp })),
    }),
    access,
  )

  const invoices: Prisma.InvoiceCreateManyInput[] = []
  const lines: Prisma.InvoiceLineCreateManyInput[] = []
  const breakdowns: Prisma.InvoiceVatBreakdownCreateManyInput[] = []
  const payments: Prisma.InvoicePaymentCreateManyInput[] = []
  const invoiceIds = new Map<string, string>()
  for (const booking of input.bookings.values()) {
    const { invoice, side } = booking
    const company = party(booking.slug)
    const other = party(side === 'SALE' ? invoice.buyer : invoice.seller)
    const seller = party(invoice.seller)
    const buyer = party(invoice.buyer)
    const vatRateBp = Math.round(invoice.vatRate * 100)
    const totals = computeInvoiceTotals([{ quantityThousandths: 1000, unitPriceCents: Math.round(invoice.net * 100), vatRateBp }])
    if (totals.totalInclTaxCents !== Math.round(grossOf(invoice) * 100)) {
      throw new Error(`Demo seed: invoice ${invoice.number} totals ${totals.totalInclTaxCents}, booked ${grossOf(invoice)}`)
    }
    const id = createId()
    invoiceIds.set(bookingKey(booking.slug, invoice.number), id)
    invoices.push({
      id,
      companyId: company.id,
      direction: side,
      tiersId: tiersIds.get(`${booking.slug}\u0000${other.slug}`) as string,
      number: invoice.number,
      issueDate: dayToDate(invoice.issueDate),
      dueDate: dayToDate(dueDateOf(invoice.issueDate, DEFAULT_PAYMENT_TERMS)),
      typeCode: '380',
      label: invoice.label,
      sellerSiren: seller.siren,
      sellerVatNumber: seller.vatNumber,
      buyerSiren: buyer.siren,
      buyerVatNumber: buyer.vatNumber,
      totalExclTax: centsToDecimal(totals.totalExclTaxCents),
      totalVat: centsToDecimal(totals.totalVatCents),
      totalInclTax: centsToDecimal(totals.totalInclTaxCents),
      entryId: booking.entryId,
    })
    lines.push({
      invoiceId: id,
      position: 1,
      label: invoice.lineLabel,
      quantity: 1,
      unitPrice: centsToDecimal(Math.round(invoice.net * 100)),
      vatRateBp,
      totalExclTax: centsToDecimal(totals.lineTotalsCents[0]),
      accountCode: side === 'SALE' ? invoice.sellerAccount : invoice.buyerAccount,
      nature: 'SERVICES',
      fixedAsset: false,
    })
    for (const row of totals.breakdown) {
      breakdowns.push({ invoiceId: id, vatRateBp: row.vatRateBp, baseAmount: centsToDecimal(row.baseCents), vatAmount: centsToDecimal(row.vatCents) })
    }
    if (booking.paymentLineId) {
      payments.push({ invoiceId: id, entryLineId: booking.paymentLineId, amount: centsToDecimal(totals.totalInclTaxCents), vatTransferEntryId: booking.vatTransferEntryId })
    }
  }

  // One billing per subsidiary and booked month, computed by the pricing engine.
  const billings: Prisma.ManagementFeeBillingCreateManyInput[] = []
  const months = new Map<string, GroupBooking[]>()
  for (const booking of input.bookings.values()) {
    if (booking.invoice.kind !== 'management_fee' || booking.side !== 'SALE' || !booking.invoice.period) continue
    const key = booking.invoice.period.start
    months.set(key, [...(months.get(key) ?? []), booking])
  }
  for (const [periodStart, sales] of months) {
    const periodEnd = sales[0].invoice.period!.end
    const result = computeManagementFees({
      pricing: convention.pricing,
      markupBp: convention.markupBp,
      costShareBp: convention.costShareBp,
      fixedAmountCents: convention.fixedAmountCents,
      allocationKey: convention.allocationKey,
      vatRateBp: convention.vatRateBp,
      costPoolCents: 0,
      subsidiaries: convention.subsidiaries.map((s) => ({
        subsidiaryId: s.subsidiaryId,
        name: s.subsidiaryId,
        sharePercentBp: s.sharePercentBp,
        eligibleDays: Number(periodEnd.slice(8)),
        revenueCents: null,
      })),
    })
    for (const sale of sales) {
      const subsidiary = party(sale.invoice.buyer)
      const part = result.parts.find((p) => p.subsidiaryId === subsidiary.id)
      const net = Math.round(sale.invoice.net * 100)
      const gross = Math.round(grossOf(sale.invoice) * 100)
      if (!part || part.amountExclTaxCents !== net || part.amountInclTaxCents !== gross) {
        throw new Error(`Demo seed: management fees of ${subsidiary.name} for ${periodStart} computed ${part?.amountExclTaxCents} / ${part?.amountInclTaxCents}, booked ${net} / ${gross}`)
      }
      billings.push({
        companyId: holding.id,
        conventionId: convention.id,
        subsidiaryId: subsidiary.id,
        periodStart: dayToDate(periodStart),
        periodEnd: dayToDate(periodEnd),
        amountExclTax: centsToDecimal(part.amountExclTaxCents),
        vatRateBp: convention.vatRateBp,
        vatAmount: centsToDecimal(part.vatCents),
        amountInclTax: centsToDecimal(part.amountInclTaxCents),
        details: billingDetails(convention, result, subsidiary.id) as Prisma.InputJsonValue,
        salesInvoiceId: invoiceIds.get(bookingKey(HOLDING_SLUG, sale.invoice.number)),
        purchaseInvoiceId: invoiceIds.get(bookingKey(subsidiary.slug, sale.invoice.number)) ?? null,
        createdById: input.createdById,
        createdAt: dayToDate(periodStart),
      })
    }
  }

  await prisma.invoice.createMany({ data: invoices })
  await prisma.invoiceLine.createMany({ data: lines })
  await prisma.invoiceVatBreakdown.createMany({ data: breakdowns })
  if (billings.length > 0) await prisma.managementFeeBilling.createMany({ data: billings })
  if (payments.length > 0) await prisma.invoicePayment.createMany({ data: payments })
  return { conventionId: convention.id, invoices: invoices.length, billings: billings.length, payments: payments.length }
}

// ── Budgets ─────────────────────────────────────────────────────────────────

/** Writes the 2026 budgets (one per company), in five statements. */
export async function seedBudgets(budgets: Array<{ companyId: string; fiscalYearId: string; lines: PlannedBudgetLine[] }>): Promise<void> {
  if (budgets.length === 0) return
  const budgetRows: Prisma.BudgetCreateManyInput[] = []
  const lineRows: Prisma.BudgetLineCreateManyInput[] = []
  const amountRows: Prisma.BudgetLineAmountCreateManyInput[] = []
  const itemRows: Prisma.BudgetRecurringItemCreateManyInput[] = []
  for (const budget of budgets) {
    const budgetId = createId()
    budgetRows.push({ id: budgetId, companyId: budget.companyId, fiscalYearId: budget.fiscalYearId })
    for (const line of budget.lines) {
      const lineId = createId()
      lineRows.push({ id: lineId, budgetId, accountPrefix: line.prefix, label: line.label })
      for (const amount of line.amounts) amountRows.push({ lineId, month: amount.month, amount: centsToDecimal(amount.cents) })
      line.recurring.forEach((item, position) =>
        itemRows.push({ lineId, label: item.label, amount: centsToDecimal(item.cents), frequency: item.frequency, startMonth: item.startMonth, endMonth: null, position }),
      )
    }
  }
  await prisma.budget.createMany({ data: budgetRows })
  await prisma.budgetLine.createMany({ data: lineRows })
  if (amountRows.length > 0) await prisma.budgetLineAmount.createMany({ data: amountRows })
  if (itemRows.length > 0) await prisma.budgetRecurringItem.createMany({ data: itemRows })
}

// ── Expense reports ─────────────────────────────────────────────────────────

function reportBody(claimantId: string, report: DemoExpenseReport) {
  // A year without a published mileage scale is refused by Kledg: its trips are left out.
  const lines = report.lines.filter((line) => line.kind !== 'MILEAGE' || mileageScaleOf(Number(line.date.slice(0, 4))) !== null)
  return CreateExpenseReportBodySchema.parse({ claimantId, label: report.label, periodStart: report.periodStart, periodEnd: report.periodEnd, lines })
}

function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`
}

export interface ExpenseReportSeedResult {
  claimantId: string
  reportIds: string[]
  /** NDF-0001 is posted (its entry validated) and lettered with its reimbursement. */
  reimbursed: boolean
}

/**
 * The president's claimant file and her three reports. `claimantUserId` is
 * her account: the visitor in the director persona (who plays her), her
 * fictional account in the others. `validatorUserId` validated NDF-0001
 * (the visitor: director or accountant). The reimbursement is lettered when
 * its transfer is booked in a validated entry (`reimbursementLineId`).
 */
export async function seedDirectorExpenseReports(input: {
  companyId: string
  claimantUserId: string
  validatorUserId: string
  cutoff: string
  now: Date
  reimbursementLineId: string | null
}): Promise<ExpenseReportSeedResult> {
  const { companyId } = input
  const claimant = await createClaimant(companyId, { ...DIRECTOR_CLAIMANT, userId: input.claimantUserId, personId: null })
  const author: ExpenseActor = { userId: input.claimantUserId, userName: DIRECTOR_CLAIMANT.name, canManage: true }
  const validator: ExpenseActor = { userId: input.validatorUserId, canManage: true }
  const options = { source: SOURCE }

  // NDF-0001: submitted and validated early April, posted, reimbursed on DIRECTOR_REIMBURSEMENT.date.
  const reimbursed = await createExpenseReport(companyId, reportBody(claimant.id, REIMBURSED_REPORT), author, options)
  await runExpenseWorkflow(companyId, reimbursed.id, { action: 'submit' }, author, { ...options, now: new Date('2026-04-01T08:30:00Z') })
  await runExpenseWorkflow(companyId, reimbursed.id, { action: 'validate' }, validator, { ...options, now: new Date('2026-04-02T09:15:00Z') })
  let lettered = false
  if (REIMBURSED_REPORT.periodEnd <= input.cutoff && input.reimbursementLineId) {
    const posted = await postExpenseReport(companyId, reimbursed.id, options)
    const validation = await validateEntries(companyId, [posted.entryId])
    if (validation.errors.length > 0) throw new Error(`Demo seed: ${DIRECTOR_REIMBURSEMENT.number} entry not validated: ${validation.errors[0].error}`)
    const claimantLine = await prisma.entryLine.findFirstOrThrow({
      where: { accountingEntryId: posted.entryId, auxiliaryAccountNumber: DIRECTOR_CLAIMANT.auxiliaryAccountNumber },
      select: { id: true, accountId: true },
    })
    await letterLines(companyId, { accountId: claimantLine.accountId, lineIds: [claimantLine.id, input.reimbursementLineId] }, { now: new Date(`${DIRECTOR_REIMBURSEMENT.date}T10:00:00Z`), source: SOURCE })
    lettered = true
  }

  // NDF-0002: the last elapsed month, submitted. NDF-0003: the current month, a draft.
  const lastMonth = nextMonth(input.cutoff.slice(0, 7))
  const submitted = await createExpenseReport(companyId, reportBody(claimant.id, submittedReport(lastMonth)), author, options)
  await runExpenseWorkflow(companyId, submitted.id, { action: 'submit' }, author, { ...options, now: input.now })
  const draft = await createExpenseReport(companyId, reportBody(claimant.id, draftReport(monthOf(input.now))), author, options)
  return { claimantId: claimant.id, reportIds: [reimbursed.id, submitted.id, draft.id], reimbursed: lettered }
}

