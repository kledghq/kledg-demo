/**
 * Lumen Holding: SAS holding company (holding animatrice) owning 100% of
 * Atelier Lumen (261, shares contributed at 120,000 EUR). It invoices
 * monthly management fees to its subsidiary (706, VAT 20%, réel normal) and
 * receives its dividends (761). Dividends benefit from the parent-subsidiary
 * regime (CGI art. 145 and 216): 95% deducted from the taxable income, the
 * remaining 5% (quote-part de frais et charges) taxed. The founder's
 * current account (455) is partly repaid in 2025.
 */

import {
  DEMO_BANK_LEDGER,
  expense,
  grossFromNet,
  income,
  monthName,
  withRetainedEarnings,
  type Draft,
  type ProfileSpec,
  type Schedule,
} from '../engine'
import { DEMO_EPOCH, LUMEN_MANAGEMENT_FEE, PARENT_SUBSIDIARY_EXEMPT_SHARE, lumenDividend } from './shared'

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
    // Same business day as Atelier Lumen's payment.
    day: LUMEN_MANAGEMENT_FEE.day,
    build: (year, month) =>
      income('management_fees', grossFromNet(LUMEN_MANAGEMENT_FEE.net, LUMEN_MANAGEMENT_FEE.vatRate), LUMEN_MANAGEMENT_FEE.vatRate, {
        label: `VIR ATELIER LUMEN management fees ${monthName(month)} ${year}`,
        counterparty: 'Atelier Lumen', category: 'sales', operationType: 'income', account: '706',
        reference: `LH-${year}-${String(month).padStart(2, '0')}`,
        invoiceNumber: `LH-${year}-${String(month).padStart(2, '0')}`,
      }),
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
  taxDeduction: (year) => lumenDividend(year).amount * PARENT_SUBSIDIARY_EXEMPT_SHARE,
}
