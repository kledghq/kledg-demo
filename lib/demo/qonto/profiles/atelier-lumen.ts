/**
 * Atelier Lumen: SASU at IS, design studio in Lyon, VAT réel normal (VAT on
 * receipts for services, CGI art. 269-2-c). The president is paid a monthly
 * salary (assimilé salarié). Wholly owned by Lumen Holding (group.ts), which
 * invoices management fees (purchase invoices in AC: 6226, 44566, 401 with
 * the holding's auxiliary account, paid on the 25th) and receives the
 * dividends. In October 2025 the studio designed the gift boxes of Maison
 * Verdier, the other subsidiary: a sales invoice in VE (411, 706, VAT
 * waiting in 44574 until paid).
 */

import {
  DEMO_BANK_LEDGER,
  between,
  dateKeyOf,
  expense,
  grossFromNet,
  income,
  monthName,
  pick,
  previousMonth,
  round2,
  scheduledBusinessDay,
  withRetainedEarnings,
  type Draft,
  type FiscalYearSummary,
  type LedgerEntry,
  type ProfileSpec,
  type RandomCategory,
  type Schedule,
} from '../engine'
import { DEMO_EPOCH, lumenDividend } from './shared'
import { DESIGN_INVOICE, GROUP_ACCOUNTS, LUMEN_SLUG, MANAGEMENT_FEE, feeInvoice, feeSubsidiary, groupInvoiceEntries, paymentDraft, receiptDraft } from './group'
import { DIRECTOR_CLAIMANT, DIRECTOR_REIMBURSEMENT, reimbursedReportTotal } from '@/lib/demo/expense-reports'

/** Monthly payroll of the president (assimilé salarié). */
export const LUMEN_PAYROLL = {
  gross: 4000,
  employerContributions: 1720,
  employeeContributions: 880,
  net: 3120,
  /** Employee + employer contributions, paid to URSSAF on the 15th of the next month. */
  urssaf: 2600,
}

export const LUMEN_LAPTOP = {
  label: 'Ordinateur portable 16 pouces',
  comment: 'Poste de travail principal du studio',
  date: '2025-03-12',
  amountHT: 2400,
  durationYears: 3,
  account: '2183',
  depreciationAccount: '2818',
  expenseAccount: '6811',
}

export const LUMEN_CLIENTS = [
  { name: 'Maison Verlaine', city: 'Lyon' },
  { name: 'Brasserie du Canal', city: 'Paris' },
  { name: 'Studio Halcyon', city: 'Nantes' },
  { name: 'Cabinet Morel & Associés', city: 'Bordeaux' },
  { name: 'Ferme des Quatre Vents', city: 'Angers' },
  { name: 'Atelier Céramique du Nord', city: 'Lille' },
  { name: 'Les Jardins de Bellevue', city: 'Tours' },
  { name: 'Clinique Vétérinaire des Saules', city: 'Rennes' },
] as const

const FREELANCERS = ['Camille R., développeuse', 'Hugo L., motion designer', 'Inès B., rédactrice']
const RESTAURANTS = ['Bistrot des Halles', 'Le Comptoir Lumière', 'Cantine du Marché', 'Boulangerie Saint-Roch', 'Café de la Gare']
/** Deductible share of the VAT on fuel of a passenger car (CGI art. 298-4-1°). */
export const FUEL_VAT_DEDUCTIBLE_SHARE = 0.8

const FUEL_STATIONS = ['Station-service Relais du Pont', 'Station-service des Quatre Routes']
const SUPPLY_SHOPS = ['Papeterie du Centre', 'Fournitures Bureau Express']
const BOOKSHOPS = ['Librairie du Vieux Port', 'Librairie Le Phare']
const PRINTERS = ['Imprimerie Delacroix', 'Atelier Sérigraphie Est']

const randoms: RandomCategory[] = [
  {
    weight: 11,
    make: (rng, key, index) => {
      const client = pick(rng, LUMEN_CLIENTS)
      const net = pick(rng, [1200, 1650, 1800, 2400, 2950, 3600, 4200, 4800, 5400, 6000, 7200])
      const invoiceNumber = `FA-${key.slice(0, 4)}-${key.slice(5, 7)}${key.slice(8, 10)}${index}`
      return income('client_payment', grossFromNet(net, 20), 20, {
        label: `VIR SEPA ${client.name.toUpperCase()} ${invoiceNumber}`,
        counterparty: client.name,
        category: 'sales',
        operationType: 'income',
        account: '706',
        reference: invoiceNumber,
        invoiceNumber,
      })
    },
  },
  {
    weight: 13,
    make: (rng) => {
      const station = pick(rng, FUEL_STATIONS)
      // Diesel or petrol of the studio's passenger car: 80 % of the VAT is
      // deductible (CGI art. 298-4-1°, both fuels since 2022; BOFiP
      // BOI-TVA-DED-30-30-20), the rest stays in 6061 (fournitures non
      // stockables: énergie, PCG art. 946-60).
      return expense('fuel', between(rng, 45, 95), 20, {
        label: `CB ${station}`, counterparty: station, category: 'fuel',
        operationType: 'card', account: '6061', vatDeductibleShare: FUEL_VAT_DEDUCTIBLE_SHARE,
      })
    },
  },
  {
    weight: 16,
    make: (rng) => {
      const place = pick(rng, RESTAURANTS)
      return expense('restaurant', between(rng, 14, 78), 10, {
        label: `CB ${place}`, counterparty: place, category: 'restaurant_and_bar',
        operationType: 'card', account: '6257',
      })
    },
  },
  {
    weight: 12,
    make: (rng) => {
      const shop = pick(rng, SUPPLY_SHOPS)
      return expense('supplies', between(rng, 12, 140), 20, {
        label: `CB ${shop}`, counterparty: shop, category: 'office_supply',
        operationType: 'card', account: '6064',
      })
    },
  },
  {
    weight: 10,
    make: (rng) => {
      const train = rng() < 0.6
      // The receipt shows 10 % VAT, but VAT on passenger transport is not
      // deductible (CGI annexe II art. 206, IV-2-3°): it stays in 6251.
      return expense('travel', train ? between(rng, 25, 140) : between(rng, 18, 55), 10, {
        label: train ? 'CB Billet de train' : 'CB Course VTC',
        counterparty: train ? 'Billet de train' : 'Course VTC',
        category: 'transport', operationType: 'card', account: '6251', recoverVat: false,
      })
    },
  },
  {
    weight: 8,
    make: (rng) => {
      const toll = rng() < 0.5
      return expense('tolls', between(rng, 4, 28), 20, {
        label: toll ? 'CB Péage autoroute' : 'CB Parking centre-ville',
        counterparty: toll ? 'Péage autoroute' : 'Parking centre-ville',
        category: 'transport', operationType: 'card', account: '6251',
      })
    },
  },
  {
    weight: 5,
    make: (rng) => {
      const shop = pick(rng, BOOKSHOPS)
      return expense('books', between(rng, 12, 60), 5.5, {
        label: `CB ${shop}`, counterparty: shop, category: 'other_expense',
        operationType: 'card', account: '6181',
      })
    },
  },
  {
    weight: 10,
    make: (rng) => {
      const printer = pick(rng, PRINTERS)
      return expense('printing', between(rng, 60, 480), 20, {
        label: `VIR ${printer}`, counterparty: printer, category: 'manufacturing',
        operationType: 'transfer', account: '604',
      })
    },
  },
  {
    weight: 4,
    make: (rng) => {
      const freelancer = pick(rng, FREELANCERS)
      const net = pick(rng, [600, 900, 1200, 1500, 1800, 2400])
      return expense('subcontracting', grossFromNet(net, 20), 20, {
        label: `VIR ${freelancer}`, counterparty: freelancer, category: 'other_service',
        operationType: 'transfer', account: '604',
      })
    },
  },
  {
    weight: 5,
    make: (rng) =>
      expense('postage', between(rng, 5, 25), 0, {
        label: 'CB Envoi postal', counterparty: 'Envoi postal', category: 'other_expense',
        operationType: 'card', account: '626', withReceipt: true,
      }),
  },
]

function dividendPayment(year: number): Draft {
  return {
    kind: 'dividend',
    side: 'debit',
    amount: lumenDividend(year).amount,
    vatRate: null,
    label: `VIR Lumen Holding dividendes exercice ${year - 1}`,
    counterparty: 'Lumen Holding',
    category: 'other_expense',
    operationType: 'transfer',
    account: '457',
    reference: `DIV-${year}`,
  }
}

const schedules: Schedule[] = [
  {
    day: 1,
    build: (year, month) =>
      expense('rent', 1500, 20, {
        label: `VIR SCI Quai des Lumières loyer ${monthName(month)} ${year}`,
        counterparty: 'SCI Quai des Lumières', category: 'rent',
        operationType: 'transfer', account: '6132',
      }),
  },
  {
    day: 2,
    build: () =>
      expense('bank_fee', 34.8, 20, {
        label: 'Abonnement compte professionnel', counterparty: 'Abonnement compte professionnel',
        category: 'fees', operationType: 'qonto_fee', account: '627',
      }),
  },
  {
    day: 3,
    build: () =>
      expense('subscription', 47.88, 20, {
        label: 'CB Hébergement web', counterparty: 'Hébergement web',
        category: 'online_service', operationType: 'card', account: '626',
      }),
  },
  {
    day: 5,
    build: () =>
      expense('subscription', 34.8, 20, {
        label: 'CB Logiciel de facturation', counterparty: 'Logiciel de facturation',
        category: 'online_service', operationType: 'card', account: '651',
      }),
  },
  {
    // Monthly design retainer of the studio's main client.
    day: 6,
    build: (year, month) => {
      const invoiceNumber = `FA-${year}-${String(month).padStart(2, '0')}-R`
      return income('client_payment', grossFromNet(1200, 20), 20, {
        label: `VIR SEPA MAISON VERLAINE forfait mensuel ${monthName(month)} ${year} ${invoiceNumber}`,
        counterparty: 'Maison Verlaine',
        category: 'sales',
        operationType: 'income',
        account: '706',
        reference: invoiceNumber,
        invoiceNumber,
      })
    },
  },
  {
    day: 8,
    build: () =>
      expense('subscription', 86.39, 20, {
        label: 'CB Suite de création graphique', counterparty: 'Suite de création graphique',
        category: 'online_service', operationType: 'card', account: '651',
      }),
  },
  {
    day: 10,
    build: () =>
      expense('telecom', 23.99, 20, {
        label: 'PRLV Opérateur mobile forfait pro', counterparty: 'Opérateur mobile',
        category: 'telecom', operationType: 'direct_debit', account: '626',
      }),
  },
  {
    day: 12,
    build: () =>
      expense('telecom', 47.99, 20, {
        label: 'PRLV Fournisseur d\'accès internet box pro', counterparty: 'Fournisseur d\'accès internet',
        category: 'telecom', operationType: 'direct_debit', account: '626',
      }),
  },
  {
    day: 20,
    build: () =>
      expense('insurance', 54.2, null, {
        label: 'PRLV Assurance RC Pro', counterparty: 'Assurance RC Pro',
        category: 'insurance', operationType: 'direct_debit', account: '616', withReceipt: true,
      }),
  },
  {
    // Pays the holding's management fee invoice of the month (401).
    day: MANAGEMENT_FEE.day,
    build: (year, month) => paymentDraft(feeInvoice(year, month, feeSubsidiary(LUMEN_SLUG))),
  },
  {
    day: 28,
    build: (year, month) => ({
      kind: 'salary',
      side: 'debit',
      amount: LUMEN_PAYROLL.net,
      vatRate: null,
      label: `VIR Salaire président ${monthName(month)} ${year}`,
      counterparty: 'Président',
      category: 'salary',
      operationType: 'transfer',
      account: '421',
    }),
  },
  {
    // Same business day as lumenDividend(year).payment.
    day: 24,
    months: [6],
    build: (year) => dividendPayment(year),
  },
  {
    day: 15,
    months: [12],
    build: () => ({
      kind: 'cfe',
      side: 'debit',
      amount: 486,
      vatRate: null,
      label: 'PRLV DGFIP CFE',
      counterparty: 'DGFiP',
      category: 'tax',
      operationType: 'direct_debit',
      account: '63511',
    }),
  },
]

const oneOffs: Record<string, Draft[]> = {
  // Maison Verdier pays the design invoice (411).
  [DESIGN_INVOICE.paymentDate]: [receiptDraft(DESIGN_INVOICE)],
  [LUMEN_LAPTOP.date]: [
    expense('equipment', grossFromNet(LUMEN_LAPTOP.amountHT, 20), 20, {
      label: 'CB Ordinateur portable 16 pouces', counterparty: 'Matériel informatique',
      category: 'hardware_and_equipment', operationType: 'card',
      account: LUMEN_LAPTOP.account, vatAccount: '44562',
    }),
  ],
  // Reimbursement of the president's expense report NDF-0001 (lib/demo/expense-reports.ts):
  // 421 debited, lettered with the report's entry by the seed.
  [DIRECTOR_REIMBURSEMENT.date]: [
    {
      kind: 'expense_reimbursement',
      side: 'debit',
      amount: reimbursedReportTotal(),
      vatRate: null,
      label: `VIR ${DIRECTOR_CLAIMANT.name} remboursement note de frais ${DIRECTOR_REIMBURSEMENT.number}`,
      counterparty: DIRECTOR_CLAIMANT.name,
      category: 'other_expense',
      operationType: 'transfer',
      account: DIRECTOR_CLAIMANT.accountCode,
      reference: DIRECTOR_REIMBURSEMENT.number,
    },
  ],
  '2026-02-10': [
    expense('equipment', grossFromNet(450, 20), 20, {
      label: 'CB Écran 27 pouces', counterparty: 'Matériel informatique',
      category: 'hardware_and_equipment', operationType: 'card', account: '6063',
    }),
  ],
}

/** Balances on 1 January 2025 (end of the 2024 fiscal year). */
const opening = {
  bank: 38000,
  vatDue: 2150,
  corporateTaxDue: 1600,
  corporateTaxInstalment: 2000,
  lines: withRetainedEarnings([
    { account: DEMO_BANK_LEDGER, debit: 38000 },
    { account: '1013', credit: 1000 },
    { account: '1061', credit: 100 },
    { account: '431', credit: 2600 },
    { account: '44551', credit: 2150 },
    { account: '444', credit: 1600 },
  ]),
}

function periodEntries(year: number, previous: FiscalYearSummary | null): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, '0')
    entries.push({
      journal: 'OD',
      date: dateKeyOf(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()),
      description: `Salaire président ${mm}/${year}`,
      reference: `PAIE-${year}-${mm}`,
      lines: [
        { account: '641', debit: LUMEN_PAYROLL.gross },
        { account: '645', debit: LUMEN_PAYROLL.employerContributions },
        { account: '421', credit: LUMEN_PAYROLL.net },
        { account: '431', credit: LUMEN_PAYROLL.urssaf },
      ],
    })
  }
  const dividend = lumenDividend(year)
  entries.push({
    journal: 'OD',
    date: dividend.agm,
    description: `Affectation du résultat ${year - 1} : dividendes votés en AGO`,
    reference: `AGO-${year}`,
    // The opening entry carries 2024 earnings in 110 (report à nouveau). From
    // 2026 on, the closing leaves the previous result in 120: the AGO
    // allocates it to dividends (457) and the rest to report à nouveau (110);
    // the legal reserve (1061) already holds 10% of the capital (Code de
    // commerce art. L. 232-10).
    lines: previous
      ? [
          { account: '120', debit: previous.netResult },
          { account: '457', credit: dividend.amount },
          { account: '110', credit: round2(previous.netResult - dividend.amount) },
        ]
      : [
          { account: '110', debit: dividend.amount },
          { account: '457', credit: dividend.amount },
        ],
  })
  entries.push(...groupInvoiceEntries(LUMEN_SLUG, year))
  return entries
}

export const ATELIER_LUMEN_SPEC: ProfileSpec = {
  slug: LUMEN_SLUG,
  seed: 'kledg-demo',
  epoch: DEMO_EPOCH,
  daily: { mode: 'busy', max: 3 },
  randoms,
  schedules,
  oneOffs,
  vatMonthly: true,
  opening,
  fixedAssets: [LUMEN_LAPTOP],
  socialDrafts: (key, year, month) => {
    if (scheduledBusinessDay(year, month, 15) !== key) return []
    const prev = previousMonth(year, month)
    return [{
      kind: 'urssaf',
      side: 'debit',
      amount: LUMEN_PAYROLL.urssaf,
      vatRate: null,
      label: `PRLV URSSAF cotisations ${monthName(prev.month)} ${prev.year}`,
      counterparty: 'URSSAF',
      category: 'tax',
      operationType: 'direct_debit',
      account: '431',
    }]
  },
  periodEntries,
  subAccounts: GROUP_ACCOUNTS[LUMEN_SLUG],
}
