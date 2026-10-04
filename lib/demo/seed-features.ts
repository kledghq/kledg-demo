/**
 * Demo seed of Kledg's management features (called by lib/demo/seed.ts once
 * the books are written), with the same data in every sandbox and persona:
 *
 * - Management fees (lib/management-fees): Lumen Holding's "Convention
 *   d'animation" with Atelier Lumen, created by the conventions service.
 *   The holding's books already carry one sales invoice a month (journal VE,
 *   profile lumen-holding.ts) settled by Atelier Lumen's transfer of the
 *   25th; each booked month becomes an invoice of Kledg's invoice module
 *   linked to its VE entry, a management fee billing whose amounts come from
 *   the pricing engine (lib/management-fees/compute.ts) and, once the
 *   transfer is booked and validated, a payment lettered with the invoice.
 *   The months after the books (the last elapsed one and the current one)
 *   are left for the visitor to compute and invoice.
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
 * invariant that is cheap to go through (one convention, one claimant, three
 * reports).
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
import { lastDayOfMonth, type DemoTransaction } from './qonto/engine'
import type { PlannedBudgetLine } from './budgets'
import { lumenFeeLineLabel } from './qonto/profiles/lumen-holding'
import { LUMEN_MANAGEMENT_FEE, lumenFeeInvoiceDate, lumenFeeInvoiceNumber } from './qonto/profiles/shared'

/** The ledger rows the seed prepares for one company and one fiscal year (lib/demo/seed.ts LedgerRows). */
export interface SeedLedgerRows {
  drafts: Set<string>
  lines: Prisma.EntryLineCreateManyInput[]
  entryByTransaction: Map<string, string>
  entryByReference: Map<string, string>
}

const SOURCE = 'demo-seed'

// ── Management fees ─────────────────────────────────────────────────────────

/** A month of management fees booked in the holding's ledger: its invoice entry and, when booked, its payment. */
export interface BookedFeeMonth {
  year: number
  month: number
  number: string
  invoiceEntryId: string
  invoiceDraft: boolean
  /** The 411 line of the transfer that settles it, when the transfer is booked in a validated entry. */
  paymentLineId: string | null
  lettered: boolean
}

/**
 * Finds the management fee invoices of a year in the holding's ledger rows
 * and letters each one with the transfer that pays it, as Kledg's lettering
 * would (one code per invoice on the 411 account of the year, AA, AB...,
 * dated on the payment), when both entries are validated: a draft (the
 * accountant persona's last weeks) stays unlettered. Mutates the line rows
 * before they are inserted.
 */
export function letterBookedFees(
  year: number,
  rows: SeedLedgerRows,
  customerAccountId: string,
  transactions: readonly DemoTransaction[],
): BookedFeeMonth[] {
  const payments = new Map(transactions.filter((t) => t.kind === 'management_fees' && t.reference).map((t) => [t.reference as string, t]))
  const customerLine = (entryId: string | undefined) =>
    entryId ? rows.lines.find((l) => l.accountingEntryId === entryId && l.accountId === customerAccountId) : undefined
  const booked: BookedFeeMonth[] = []
  let code: string | null = null
  for (let month = 1; month <= 12; month++) {
    const number = lumenFeeInvoiceNumber(year, month)
    const invoiceEntryId = rows.entryByReference.get(number)
    if (!invoiceEntryId) continue
    const invoiceLine = customerLine(invoiceEntryId)
    if (!invoiceLine) throw new Error(`Demo seed: invoice ${number} has no customer line`)
    const payment = payments.get(number)
    const paymentEntryId = payment ? rows.entryByTransaction.get(payment.transactionId) : undefined
    const paymentLine = paymentEntryId && !rows.drafts.has(paymentEntryId) ? customerLine(paymentEntryId) : undefined
    const invoiceDraft = rows.drafts.has(invoiceEntryId)
    const lettered = Boolean(paymentLine) && !invoiceDraft
    if (lettered && payment && paymentLine) {
      code = code ? successorCode(code) : 'AA'
      for (const line of [invoiceLine, paymentLine]) {
        line.letteringCode = code
        line.letteringDate = dayToDate(payment.date)
      }
    }
    booked.push({ year, month, number, invoiceEntryId, invoiceDraft, paymentLineId: paymentLine?.id ?? null, lettered })
  }
  return booked
}

interface Party {
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

export interface ManagementFeeSeedResult {
  conventionId: string
  billings: number
  payments: number
}

/**
 * The holding's convention and, for every booked month, the sales invoice
 * (linked to its VE entry), the billing and the payment. Throws when the
 * pricing engine disagrees with the booked amounts: the books and the
 * invoices must say the same thing.
 */
export async function seedManagementFees(input: {
  holding: Party
  subsidiary: Party
  /** The visitor: reads both companies (the convention service checks reports:read in the subsidiary). */
  userId: string
  /** Who prepared the invoices: the fictional director when there is one, else the visitor. */
  createdById: string
  booked: BookedFeeMonth[]
}): Promise<ManagementFeeSeedResult> {
  const { holding, subsidiary } = input
  const tiers = await createTiers(
    holding.id,
    {
      kind: 'CUSTOMER',
      name: subsidiary.name,
      siren: subsidiary.siren,
      vatNumber: subsidiary.vatNumber,
      defaultAccountCode: '706',
      defaultVatRateBp: LUMEN_MANAGEMENT_FEE.vatRate * 100,
      notes: `Filiale à 100 %, ${LUMEN_MANAGEMENT_FEE.convention}`,
    },
    { source: SOURCE },
  )
  if (tiers.auxiliaryAccountNumber !== LUMEN_MANAGEMENT_FEE.customerAux) {
    throw new Error(`Demo seed: ${subsidiary.name} got the auxiliary account ${tiers.auxiliaryAccountNumber}, the books use ${LUMEN_MANAGEMENT_FEE.customerAux}`)
  }
  const access = userGroupAccess({ id: input.userId, email: '', name: null, role: 'user' })
  const convention = await createConvention(
    holding.id,
    ConventionBodySchema.parse({
      label: LUMEN_MANAGEMENT_FEE.convention,
      pricing: 'FIXED',
      fixedAmountCents: LUMEN_MANAGEMENT_FEE.net * 100,
      allocationKey: 'EQUAL',
      vatRateBp: LUMEN_MANAGEMENT_FEE.vatRate * 100,
      revenueAccountCode: '706',
      expenseAccountCode: '6226',
      invoicePrefix: LUMEN_MANAGEMENT_FEE.invoicePrefix,
      startDate: '2025-01-01',
      notes:
        'Direction générale, animation commerciale et gestion administrative et financière d’Atelier Lumen. Forfait mensuel de 1 500 € HT, facturé le premier jour du mois et réglé le 25. TVA sur les débits.',
      subsidiaries: [{ subsidiaryId: subsidiary.id }],
    }),
    access,
  )

  const invoices: Prisma.InvoiceCreateManyInput[] = []
  const lines: Prisma.InvoiceLineCreateManyInput[] = []
  const breakdowns: Prisma.InvoiceVatBreakdownCreateManyInput[] = []
  const billings: Prisma.ManagementFeeBillingCreateManyInput[] = []
  const payments: Prisma.InvoicePaymentCreateManyInput[] = []
  const net = LUMEN_MANAGEMENT_FEE.net * 100
  for (const fee of input.booked) {
    const periodStart = lumenFeeInvoiceDate(fee.year, fee.month)
    const periodEnd = lastDayOfMonth(fee.year, fee.month)
    const result = computeManagementFees({
      pricing: convention.pricing,
      markupBp: convention.markupBp,
      costShareBp: convention.costShareBp,
      fixedAmountCents: convention.fixedAmountCents,
      allocationKey: convention.allocationKey,
      vatRateBp: convention.vatRateBp,
      costPoolCents: 0,
      subsidiaries: [{ subsidiaryId: subsidiary.id, name: subsidiary.name, sharePercentBp: null, eligibleDays: Number(periodEnd.slice(8)), revenueCents: null }],
    })
    const part = result.parts[0]
    const totals = computeInvoiceTotals([{ quantityThousandths: 1000, unitPriceCents: part.amountExclTaxCents, vatRateBp: convention.vatRateBp }])
    const bookedGross = net + Math.round((net * LUMEN_MANAGEMENT_FEE.vatRate) / 100)
    if (part.amountExclTaxCents !== net || part.amountInclTaxCents !== bookedGross || totals.totalInclTaxCents !== part.amountInclTaxCents) {
      throw new Error(`Demo seed: management fees of ${periodStart} computed ${part.amountExclTaxCents} / ${part.amountInclTaxCents}, booked ${net} / ${bookedGross}`)
    }
    const invoiceId = createId()
    invoices.push({
      id: invoiceId,
      companyId: holding.id,
      direction: 'SALE',
      tiersId: tiers.id,
      number: fee.number,
      issueDate: dayToDate(periodStart),
      dueDate: dayToDate(dueDateOf(periodStart, DEFAULT_PAYMENT_TERMS)),
      typeCode: '380',
      label: convention.label,
      sellerSiren: holding.siren,
      sellerVatNumber: holding.vatNumber,
      buyerSiren: tiers.siren,
      buyerVatNumber: tiers.vatNumber,
      totalExclTax: centsToDecimal(totals.totalExclTaxCents),
      totalVat: centsToDecimal(totals.totalVatCents),
      totalInclTax: centsToDecimal(totals.totalInclTaxCents),
      entryId: fee.invoiceEntryId,
    })
    lines.push({
      invoiceId,
      position: 1,
      label: lumenFeeLineLabel(fee.year, fee.month),
      quantity: 1,
      unitPrice: centsToDecimal(part.amountExclTaxCents),
      vatRateBp: convention.vatRateBp,
      totalExclTax: centsToDecimal(totals.lineTotalsCents[0]),
      accountCode: convention.revenueAccountCode,
      nature: 'SERVICES',
      fixedAsset: false,
    })
    for (const row of totals.breakdown) {
      breakdowns.push({ invoiceId, vatRateBp: row.vatRateBp, baseAmount: centsToDecimal(row.baseCents), vatAmount: centsToDecimal(row.vatCents) })
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
      salesInvoiceId: invoiceId,
      createdById: input.createdById,
      createdAt: dayToDate(periodStart),
    })
    if (fee.paymentLineId) {
      payments.push({ invoiceId, entryLineId: fee.paymentLineId, amount: centsToDecimal(part.amountInclTaxCents) })
    }
  }
  await prisma.invoice.createMany({ data: invoices })
  await prisma.invoiceLine.createMany({ data: lines })
  await prisma.invoiceVatBreakdown.createMany({ data: breakdowns })
  await prisma.managementFeeBilling.createMany({ data: billings })
  if (payments.length > 0) await prisma.invoicePayment.createMany({ data: payments })
  return { conventionId: convention.id, billings: billings.length, payments: payments.length }
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

