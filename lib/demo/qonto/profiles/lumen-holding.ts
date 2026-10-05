/**
 * Lumen Holding: SAS holding company (holding animatrice) of the Lumen group
 * (group.ts): it owns 100% of Atelier Lumen and of Maison Verdier and 40% of
 * SCI Les Tilleuls, contributed by their owners (261100, 261200, 261300 at
 * their contribution values, against the capital, 1013). It invoices monthly
 * management fees to its two subsidiaries under their "Convention
 * d'animation": a sales invoice each on the first day of the month (journal
 * VE: 411 with the subsidiary's auxiliary account, 706, VAT 20 % collected on
 * debits), settled by the transfers of the 25th (411), as Kledg's invoice
 * module books them (lib/invoices/posting-plan.ts). It lent 15,000 EUR to
 * Maison Verdier in current account (451100) and invoices the interest each
 * year end (7638). It receives Atelier Lumen's dividends (761), under the
 * parent-subsidiary regime (CGI art. 145 and 216): 95% deducted from the
 * taxable income, the remaining 5% (quote-part de frais et charges) taxed.
 * The founder's current account (455) is partly repaid in 2025.
 */

import {
  DEMO_BANK_LEDGER,
  expense,
  withRetainedEarnings,
  type Draft,
  type ProfileSpec,
  type Schedule,
} from '../engine'
import { DEMO_EPOCH, PARENT_SUBSIDIARY_EXEMPT_SHARE, lumenDividend } from './shared'
import {
  GROUP_ACCOUNTS,
  GROUP_STAKES,
  HOLDING_CAPITAL,
  HOLDING_FOUNDER,
  HOLDING_SLUG,
  MANAGEMENT_FEE,
  advanceDrafts,
  feeInvoice,
  groupInvoiceEntries,
  interestInvoice,
  receiptDraft,
} from './group'

export { HOLDING_FOUNDER, HOLDING_SLUG }

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
  // The transfers of the subsidiaries, same business day as their payments:
  // each settles its invoice of the month (customer account, no VAT: the
  // VAT was due on the invoice).
  ...MANAGEMENT_FEE.subsidiaries.map((sub): Schedule => ({
    day: MANAGEMENT_FEE.day,
    build: (year, month) => receiptDraft(feeInvoice(year, month, sub)),
  })),
  {
    // Maison Verdier pays the interest of the year before mid January.
    day: 15,
    months: [1],
    build: (year) => {
      const interest = interestInvoice(year - 1)
      return interest ? receiptDraft(interest) : null
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
  ...advanceDrafts(HOLDING_SLUG),
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
      ...GROUP_STAKES.map((stake) => ({ account: stake.titres.account, debit: stake.titres.amount })),
      { account: DEMO_BANK_LEDGER, debit: 6000 },
      { account: '1013', credit: HOLDING_CAPITAL },
      { account: '455', credit: 3000 },
    ]),
  },
  periodEntries: (year) => groupInvoiceEntries(HOLDING_SLUG, year),
  taxDeduction: (year) => lumenDividend(year).amount * PARENT_SUBSIDIARY_EXEMPT_SHARE,
  subAccounts: GROUP_ACCOUNTS[HOLDING_SLUG],
}
