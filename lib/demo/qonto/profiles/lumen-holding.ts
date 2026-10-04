/**
 * Lumen Holding: SAS holding company (holding animatrice) owning 100% of
 * Atelier Lumen (261, shares contributed at 120,000 EUR). It invoices
 * monthly management fees to its subsidiary under their "Convention
 * d'animation" (shared.ts LUMEN_MANAGEMENT_FEE): a sales invoice on the
 * first day of the month (journal VE: 411 with Atelier Lumen's auxiliary
 * account, 706, VAT 20 % collected on debits), settled by the transfer of
 * the 25th (411), as Kledg's invoice module books them
 * (lib/invoices/posting-plan.ts). It receives its subsidiary's dividends (761). Dividends benefit from the parent-subsidiary
 * regime (CGI art. 145 and 216): 95% deducted from the taxable income, the
 * remaining 5% (quote-part de frais et charges) taxed. The founder's
 * current account (455) is partly repaid in 2025.
 */

import { formatVatRate } from '@/lib/invoices/amounts'
import { formatIsoDateFr } from '@/lib/utils/date'
import {
  DEMO_BANK_LEDGER,
  expense,
  grossFromNet,
  lastDayOfMonth,
  monthName,
  round2,
  withRetainedEarnings,
  type Draft,
  type LedgerEntry,
  type ProfileSpec,
  type Schedule,
} from '../engine'
import {
  DEMO_EPOCH,
  LUMEN_MANAGEMENT_FEE,
  PARENT_SUBSIDIARY_EXEMPT_SHARE,
  lumenDividend,
  lumenFeeInvoiceDate,
  lumenFeeInvoiceNumber,
} from './shared'

export const HOLDING_SLUG = 'lumen-holding'

/** Book value of the Atelier Lumen shares (contribution in kind). */
export const HOLDING_PARTICIPATION = 120000

export const HOLDING_FOUNDER = 'Claire Vasseur'

const schedules: Schedule[] = [
  {
    day: 2,
    build: () =>
      expense('bank_fee', 9, 20, {
        label: 'Abonnement compte professionnel', counterparty: 'Abonnement compte professionnel',
        category: 'fees', operationType: 'qonto_fee', account: '627',
      }),
  },
  {
    day: 10,
    months: [1, 4, 7, 10],
    build: (year, month) =>
      expense('accounting', 540, 20, {
        label: `VIR Cabinet Comptable Rive Gauche honoraires T${Math.ceil(month / 3)} ${year}`,
        counterparty: 'Cabinet Comptable Rive Gauche', category: 'other_service',
        operationType: 'transfer', account: '6226',
      }),
  },
  {
    day: 10,
    months: [7],
    build: (year) => ({
      kind: 'legal',
      side: 'debit',
      amount: 46.2,
      vatRate: null,
      label: `CB Greffe du tribunal de commerce dépôt des comptes ${year - 1}`,
      counterparty: 'Greffe du tribunal de commerce',
      category: 'legal_and_accounting',
      operationType: 'card',
      account: '6227',
      withReceipt: true,
    }),
  },
  {
    // Same business day as Atelier Lumen's payment: it settles the invoice
    // of the month (customer account, no VAT: the VAT was due on the invoice).
    day: LUMEN_MANAGEMENT_FEE.day,
    build: (year, month): Draft => {
      const number = lumenFeeInvoiceNumber(year, month)
      const gross = feeGross()
      return {
        kind: 'management_fees',
        side: 'credit',
        amount: gross,
        vatRate: null,
        label: `VIR ATELIER LUMEN management fees ${monthName(month)} ${year} ${number}`,
        counterparty: 'Atelier Lumen',
        category: 'sales',
        operationType: 'income',
        account: '411',
        reference: number,
        invoiceNumber: number,
        lines: [{ account: '411', credit: gross, auxiliary: FEE_CUSTOMER }],
      }
    },
  },
  {
    // Same business day as lumenDividend(year).payment.
    day: 24,
    months: [6],
    build: (year): Draft => ({
      kind: 'dividend',
      side: 'credit',
      amount: lumenDividend(year).amount,
      vatRate: null,
      label: `VIR ATELIER LUMEN dividendes exercice ${year - 1}`,
      counterparty: 'Atelier Lumen',
      category: 'other_income',
      operationType: 'income',
      account: '761',
      reference: `DIV-${year}`,
    }),
  },
]

const oneOffs: Record<string, Draft[]> = {
  '2025-09-15': [{
    kind: 'current_account',
    side: 'debit',
    amount: 2000,
    vatRate: null,
    label: `VIR ${HOLDING_FOUNDER.toUpperCase()} remboursement compte courant`,
    counterparty: HOLDING_FOUNDER,
    category: 'other_expense',
    operationType: 'transfer',
    account: '455',
  }],
}

const FEE_CUSTOMER = { number: LUMEN_MANAGEMENT_FEE.customerAux, label: LUMEN_MANAGEMENT_FEE.customerName }

function feeGross(): number {
  return grossFromNet(LUMEN_MANAGEMENT_FEE.net, LUMEN_MANAGEMENT_FEE.vatRate)
}

/**
 * Line label of a month's invoice: the label the management fee billing
 * gives it (lib/management-fees/bill-management-fees.service.ts lineLabel).
 */
export function lumenFeeLineLabel(year: number, month: number): string {
  const start = lumenFeeInvoiceDate(year, month)
  return `Prestations de services (convention « ${LUMEN_MANAGEMENT_FEE.convention} ») du ${formatIsoDateFr(start)} au ${formatIsoDateFr(lastDayOfMonth(year, month))}`
}

/**
 * The sales invoices of the management fees, one per month, as Kledg posts
 * a sales invoice of services with VAT on debits (lib/invoices/posting-plan.ts):
 * 411 (auxiliary account of the customer) debited with the total, 706 and
 * 44571 credited.
 */
function feeInvoices(year: number): LedgerEntry[] {
  const vat = round2(feeGross() - LUMEN_MANAGEMENT_FEE.net)
  return Array.from({ length: 12 }, (_, index): LedgerEntry => {
    const month = index + 1
    const number = lumenFeeInvoiceNumber(year, month)
    const description = `Facture ${number} ${LUMEN_MANAGEMENT_FEE.customerName}`
    return {
      journal: 'VE',
      date: lumenFeeInvoiceDate(year, month),
      description,
      reference: number,
      lines: [
        { account: '411', debit: feeGross(), description, auxiliary: FEE_CUSTOMER },
        { account: '706', credit: LUMEN_MANAGEMENT_FEE.net, description: lumenFeeLineLabel(year, month) },
        { account: '44571', credit: vat, description: `${description}, TVA ${formatVatRate(LUMEN_MANAGEMENT_FEE.vatRate * 100)}` },
      ],
    }
  })
}

export const LUMEN_HOLDING_SPEC: ProfileSpec = {
  slug: HOLDING_SLUG,
  seed: 'kledg-demo-holding',
  epoch: DEMO_EPOCH,
  daily: { mode: 'sparse', probability: 0 },
  randoms: [],
  schedules,
  oneOffs,
  vatMonthly: true,
  opening: {
    bank: 6000,
    vatDue: 0,
    corporateTaxDue: 0,
    corporateTaxInstalment: 0,
    lines: withRetainedEarnings([
      { account: '261', debit: HOLDING_PARTICIPATION },
      { account: DEMO_BANK_LEDGER, debit: 6000 },
      { account: '1013', credit: HOLDING_PARTICIPATION },
      { account: '455', credit: 3000 },
    ]),
  },
  periodEntries: (year) => feeInvoices(year),
  taxDeduction: (year) => lumenDividend(year).amount * PARENT_SUBSIDIARY_EXEMPT_SHARE,
}
