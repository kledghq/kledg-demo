/**
 * SCI Les Tilleuls: SCI at IS owning one residential building in Lyon (four
 * flats let unfurnished). Rents (706) are exempt from VAT (CGI art. 261 D 2°),
 * so the company is outside VAT and books its purchases VAT included. The
 * building is split between land (2111, not depreciated) and construction
 * (2131, straight-line over 30 years, PCG art. 214-13). It was financed by a
 * bank loan (164) repaid monthly: each instalment is split between capital
 * (164) and interest (6611).
 */

import {
  DEMO_BANK_LEDGER,
  between,
  dateKeyOf,
  expense,
  income,
  monthName,
  pick,
  round2,
  withRetainedEarnings,
  type ProfileSpec,
  type RandomCategory,
  type Schedule,
} from '../engine'
import { buildDepreciationPlan, sumPlanForPeriod } from '@/lib/fixed-assets/depreciation-plan'
import { DEMO_EPOCH } from './shared'

export const TILLEULS_SLUG = 'sci-les-tilleuls'

export const TILLEULS_LAND = { account: '2111', amount: 76000 }

export const TILLEULS_CONSTRUCTION = {
  label: 'Immeuble 14 rue des Tilleuls (construction)',
  comment: 'Immeuble de quatre logements, hors terrain (76 000 EUR, non amortissable)',
  date: '2022-07-01',
  amountHT: 304000,
  durationYears: 30,
  account: '2131',
  depreciationAccount: '2813',
  expenseAccount: '6811',
}

export const TILLEULS_TENANTS = [
  { name: 'Julie Fontaine', flat: 'T3 1er étage', rent: 820, day: 3 },
  { name: 'Marc et Léa Bertin', flat: 'T2 2e étage', rent: 760, day: 4 },
  { name: 'Samir Haddad', flat: 'T4 3e étage', rent: 905, day: 5 },
  { name: 'Chloé Garnier', flat: 'T2 rez-de-chaussée', rent: 690, day: 6 },
] as const

/** Property management fees: 8% excl. VAT of the rents collected, VAT at 20% not recoverable. */
export const TILLEULS_MANAGEMENT_RATE = 0.08

/** Bank loan: 300,000 EUR at 3.2% over 20 years, first instalment on 5 August 2022. */
export const TILLEULS_LOAN = {
  principal: 300000,
  annualRate: 0.032,
  months: 240,
  firstYear: 2022,
  firstMonth: 8,
  day: 5,
}

export interface LoanInstalment {
  number: number
  year: number
  month: number
  payment: number
  interest: number
  capital: number
  /** Capital still due after the instalment. */
  outstanding: number
}

let loanTable: LoanInstalment[] | null = null

/** Constant-instalment amortization table of the loan. */
export function tilleulsLoanTable(): LoanInstalment[] {
  if (loanTable) return loanTable
  const { principal, annualRate, months } = TILLEULS_LOAN
  const r = annualRate / 12
  const payment = round2((principal * r) / (1 - Math.pow(1 + r, -months)))
  const table: LoanInstalment[] = []
  let outstanding = principal
  let year = TILLEULS_LOAN.firstYear
  let month = TILLEULS_LOAN.firstMonth
  for (let n = 1; n <= months; n++) {
    const interest = round2(outstanding * r)
    const capital = n === months ? outstanding : round2(payment - interest)
    outstanding = round2(outstanding - capital)
    table.push({ number: n, year, month, payment: round2(capital + interest), interest, capital, outstanding })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  loanTable = table
  return table
}

export function tilleulsInstalment(year: number, month: number): LoanInstalment | null {
  return tilleulsLoanTable().find((i) => i.year === year && i.month === month) ?? null
}

/** Capital due on 1 January of a year. */
export function tilleulsOutstandingAt(year: number): number {
  const last = tilleulsLoanTable().filter((i) => i.year < year).at(-1)
  return last ? last.outstanding : TILLEULS_LOAN.principal
}

/** Accumulated depreciation of the construction at the end of a year. */
export function tilleulsAccumulatedDepreciation(year: number): number {
  const plan = buildDepreciationPlan({
    acquisitionValue: TILLEULS_CONSTRUCTION.amountHT,
    amortizableAmount: TILLEULS_CONSTRUCTION.amountHT,
    depreciationMethod: 'linear',
    depreciationRate: null,
    depreciationDuration: TILLEULS_CONSTRUCTION.durationYears,
    decliningCoefficient: null,
    depreciationStartDate: new Date(`${TILLEULS_CONSTRUCTION.date}T00:00:00.000Z`),
  })
  return round2(sumPlanForPeriod(plan, new Date(`${TILLEULS_CONSTRUCTION.date}T00:00:00.000Z`), new Date(Date.UTC(year, 11, 31))))
}

const TRADES = [
  { name: 'Plomberie Martin', rate: 10 },
  { name: 'Électricité Générale Durand', rate: 10 },
  { name: 'Serrurerie du Centre', rate: 10 },
  { name: 'Entretien Parties Communes Lyon', rate: 20 },
] as const

const randoms: RandomCategory[] = [
  {
    weight: 1,
    make: (rng) => {
      const trade = pick(rng, TRADES)
      return expense('maintenance', between(rng, 90, 650), trade.rate, {
        label: `VIR ${trade.name} intervention immeuble`, counterparty: trade.name,
        category: 'maintenance', operationType: 'transfer', account: '615', recoverVat: false,
      })
    },
  },
]

const monthlyRents = TILLEULS_TENANTS.reduce((sum, t) => sum + t.rent, 0)

const schedules: Schedule[] = [
  ...TILLEULS_TENANTS.map((tenant): Schedule => ({
    day: tenant.day,
    build: (year, month) =>
      income('rent', tenant.rent, null, {
        label: `VIR ${tenant.name.toUpperCase()} LOYER ${monthName(month).toUpperCase()} ${year}`,
        counterparty: tenant.name, category: 'sales', operationType: 'income', account: '706',
        reference: `LOYER-${year}-${String(month).padStart(2, '0')}`,
      }),
  })),
  {
    day: 2,
    build: () => ({
      kind: 'bank_fee',
      side: 'debit',
      amount: 12,
      vatRate: null,
      label: 'Abonnement compte professionnel',
      counterparty: 'Abonnement compte professionnel',
      category: 'fees',
      operationType: 'qonto_fee',
      account: '627',
    }),
  },
  {
    day: TILLEULS_LOAN.day,
    build: (year, month) => {
      const instalment = tilleulsInstalment(year, month)
      if (!instalment) return null
      return {
        kind: 'loan',
        side: 'debit',
        amount: instalment.payment,
        vatRate: null,
        label: `PRLV Échéance prêt immobilier n°08745 ${instalment.number}/${TILLEULS_LOAN.months}`,
        counterparty: 'Prêt immobilier',
        category: 'finance',
        operationType: 'direct_debit',
        account: '164',
        lines: [
          { account: '164', debit: instalment.capital, description: `Capital échéance ${instalment.number}` },
          { account: '6611', debit: instalment.interest, description: `Intérêts échéance ${instalment.number}` },
        ],
      }
    },
  },
  {
    day: 10,
    build: (year, month) =>
      expense('management_fees', round2(monthlyRents * TILLEULS_MANAGEMENT_RATE * 1.2), 20, {
        label: `PRLV Saône Gestion Immobilière honoraires ${monthName(month)} ${year}`,
        counterparty: 'Saône Gestion Immobilière', category: 'other_service',
        operationType: 'direct_debit', account: '6226', recoverVat: false,
      }),
  },
  {
    day: 20,
    build: () =>
      expense('insurance', 79.5, null, {
        label: 'PRLV Assurance propriétaire non occupant', counterparty: 'Assurance PNO',
        category: 'insurance', operationType: 'direct_debit', account: '616', withReceipt: true,
      }),
  },
  {
    day: 10,
    months: [4],
    build: (year) =>
      expense('accounting', 1080, 20, {
        label: `VIR Cabinet Comptable Bellecour honoraires bilan ${year - 1}`,
        counterparty: 'Cabinet Comptable Bellecour', category: 'other_service',
        operationType: 'transfer', account: '6226', recoverVat: false,
      }),
  },
  {
    day: 15,
    months: [10],
    build: (year) => ({
      kind: 'property_tax',
      side: 'debit',
      amount: 3450,
      vatRate: null,
      label: `PRLV DGFIP Taxe foncière ${year}`,
      counterparty: 'DGFiP',
      category: 'tax',
      operationType: 'direct_debit',
      account: '63512',
    }),
  },
]

export const SCI_LES_TILLEULS_SPEC: ProfileSpec = {
  slug: TILLEULS_SLUG,
  seed: 'kledg-demo-tilleuls',
  epoch: DEMO_EPOCH,
  daily: { mode: 'sparse', probability: 0.04 },
  randoms,
  schedules,
  vatMonthly: false,
  opening: {
    bank: 14000,
    vatDue: 0,
    corporateTaxDue: 1250,
    corporateTaxInstalment: 0,
    lines: withRetainedEarnings([
      { account: '2111', debit: TILLEULS_LAND.amount },
      { account: '2131', debit: TILLEULS_CONSTRUCTION.amountHT },
      { account: '2813', credit: tilleulsAccumulatedDepreciation(2024) },
      { account: DEMO_BANK_LEDGER, debit: 14000 },
      { account: '1013', credit: 1000 },
      { account: '164', credit: tilleulsOutstandingAt(2025) },
      { account: '455', credit: 86000 },
      { account: '444', credit: 1250 },
    ]),
  },
  fixedAssets: [TILLEULS_CONSTRUCTION],
}

/** Date key of the first instalment (exported for tests). */
export const TILLEULS_FIRST_INSTALMENT = dateKeyOf(TILLEULS_LOAN.firstYear, TILLEULS_LOAN.firstMonth, TILLEULS_LOAN.day)
