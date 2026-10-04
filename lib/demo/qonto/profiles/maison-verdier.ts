/**
 * Maison Verdier: EURL at IS, online delicatessen (épicerie fine en ligne) in
 * Bordeaux, VAT réel normal. Sells goods (707): food at 5.5% (CGI art.
 * 278-0 bis A) through the online shop, paid out twice a week by the card
 * payment provider, and corporate gift boxes with wine at 20% paid by
 * transfer. Buys goods for resale (607) from producers; stock variation
 * (6037) booked at closing. The majority manager (gérant majoritaire, TNS)
 * takes no salary: his TNS contributions are charged to 646 and paid
 * monthly to URSSAF.
 */

import {
  DEMO_BANK_LEDGER,
  addDays,
  between,
  createRng,
  dateKeyOf,
  daysInMonth,
  expense,
  grossFromNet,
  income,
  isBusinessDay,
  monthName,
  parseDateKey,
  pick,
  previousMonth,
  round2,
  withRetainedEarnings,
  type LedgerEntry,
  type ProfileSpec,
  type RandomCategory,
  type Schedule,
} from '../engine'
import { DEMO_EPOCH } from './shared'

export const VERDIER_SLUG = 'maison-verdier'

/** Card payment provider fees, invoiced monthly on the previous month's payouts (financial service, no VAT). */
export const VERDIER_CARD_FEE_RATE = 0.014

/** Monthly TNS contributions of the majority manager (provisional schedule). */
export const VERDIER_TNS_CONTRIBUTIONS = 380

/** Goods in stock at the end of each year (physical count). */
export const VERDIER_STOCK: Record<number, number> = { 2024: 18000, 2025: 21400, 2026: 23800 }

export const VERDIER_DISPLAY_CASE = {
  label: 'Vitrine réfrigérée et rayonnages',
  comment: 'Préparation des commandes et stockage des produits frais',
  date: '2025-04-08',
  amountHT: 6800,
  durationYears: 5,
  account: '2154',
  depreciationAccount: '2815',
  expenseAccount: '6811',
}

const PRODUCERS = [
  { name: 'Moulin à huile des Alpilles', rate: 5.5 },
  { name: 'Conserverie de l\'Atlantique', rate: 5.5 },
  { name: 'Biscuiterie des Monts', rate: 5.5 },
  { name: 'Torréfaction Saint-Michel', rate: 5.5 },
  { name: 'Miellerie du Vercors', rate: 5.5 },
  { name: 'Fromagerie des Alpages', rate: 5.5 },
] as const

export const VERDIER_CORPORATE_CLIENTS = [
  'Cabinet Ravel Avocats',
  'Agence Horizon Immobilier',
  'Groupe Mercier Conseil',
  'Hôtel du Parc',
  'Comité social Aéroservices',
] as const

const RESTAURANTS = ['Brasserie des Chartrons', 'Le Petit Comptoir', 'Café du Marché']

/** Amount (VAT included) paid out by the card provider on a payout day. */
export function verdierPayout(key: string): number {
  const rng = createRng(`${VERDIER_SLUG}-payout:${key}`)
  return between(rng, 700, 1900)
}

function isPayoutDay(key: string): boolean {
  const weekday = parseDateKey(key).getUTCDay()
  return (weekday === 2 || weekday === 5) && isBusinessDay(key)
}

/** Sum of the payouts of a month. */
export function verdierMonthlyPayouts(year: number, month: number): number {
  let total = 0
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const key = dateKeyOf(year, month, d)
    if (isPayoutDay(key)) total += verdierPayout(key)
  }
  return round2(total)
}

const randoms: RandomCategory[] = [
  {
    // Extra orders for the corporate gift boxes.
    weight: 4,
    make: (rng) => {
      const producer = pick(rng, PRODUCERS)
      const net = pick(rng, [650, 900, 1200, 1500, 1850, 2200, 2600])
      return expense('goods_purchase', grossFromNet(net, producer.rate), producer.rate, {
        label: `VIR ${producer.name} facture marchandises`, counterparty: producer.name,
        category: 'supplies', operationType: 'transfer', account: '607',
      })
    },
  },
  {
    weight: 6,
    make: (rng, key, index) => {
      const client = pick(rng, VERDIER_CORPORATE_CLIENTS)
      const net = pick(rng, [480, 720, 960, 1350, 1800, 2400, 3200])
      const invoiceNumber = `MV-${key.slice(0, 4)}-${key.slice(5, 7)}${key.slice(8, 10)}${index}`
      return income('client_payment', grossFromNet(net, 20), 20, {
        label: `VIR ${client.toUpperCase()} coffrets cadeaux ${invoiceNumber}`,
        counterparty: client, category: 'sales', operationType: 'income',
        account: '707', reference: invoiceNumber, invoiceNumber,
      })
    },
  },
  {
    weight: 26,
    make: (rng) =>
      expense('shipping', between(rng, 35, 240), 20, {
        label: 'CB Transporteur colis expéditions', counterparty: 'Transporteur colis',
        category: 'logistics', operationType: 'card', account: '6242',
      }),
  },
  {
    weight: 12,
    make: (rng) => {
      const supplier = pick(rng, ['Cartonnerie du Rhône', 'Emballages et Calage'])
      return expense('packaging', between(rng, 40, 320), 20, {
        label: `CB ${supplier}`, counterparty: supplier,
        category: 'supplies', operationType: 'card', account: '6026',
      })
    },
  },
  {
    weight: 9,
    make: (rng) =>
      expense('advertising', between(rng, 30, 180), 20, {
        label: 'CB Publicité en ligne campagne', counterparty: 'Publicité en ligne',
        category: 'marketing', operationType: 'card', account: '6231',
      }),
  },
  {
    weight: 8,
    make: (rng) =>
      expense('supplies', between(rng, 12, 90), 20, {
        label: 'CB Papeterie du Centre', counterparty: 'Papeterie du Centre',
        category: 'office_supply', operationType: 'card', account: '6064',
      }),
  },
  {
    weight: 8,
    make: (rng) => {
      const place = pick(rng, RESTAURANTS)
      return expense('restaurant', between(rng, 16, 64), 10, {
        label: `CB ${place}`, counterparty: place, category: 'restaurant_and_bar',
        operationType: 'card', account: '6257',
      })
    },
  },
  {
    weight: 8,
    make: (rng) =>
      expense('postage', between(rng, 6, 40), 0, {
        label: 'CB Envoi postal', counterparty: 'Envoi postal', category: 'other_expense',
        operationType: 'card', account: '626', withReceipt: true,
      }),
  },
]

/**
 * Weekly restocking order, paid on Mondays: about 60% (cost of goods) of the
 * previous week's online sales excluding VAT, from a different producer each week.
 */
export function verdierRestockingOrder(key: string): { producer: string; net: number } | null {
  let salesHT = 0
  for (let i = 1; i <= 7; i++) {
    const day = addDays(key, -i)
    if (day >= DEMO_EPOCH && isPayoutDay(day)) salesHT += verdierPayout(day) / 1.055
  }
  if (salesHT === 0) return null
  const week = Math.floor((parseDateKey(key).getTime() - parseDateKey(DEMO_EPOCH).getTime()) / (7 * 86400000))
  return { producer: PRODUCERS[week % PRODUCERS.length].name, net: Math.round((salesHT * 0.6) / 10) * 10 }
}

const schedules: Schedule[] = [
  {
    weekdays: [1],
    build: (_year, _month, key) => {
      const order = verdierRestockingOrder(key)
      if (!order) return null
      return expense('goods_purchase', grossFromNet(order.net, 5.5), 5.5, {
        label: `VIR ${order.producer} commande hebdomadaire`, counterparty: order.producer,
        category: 'supplies', operationType: 'transfer', account: '607',
      })
    },
  },
  {
    weekdays: [2, 5],
    build: (_year, _month, key) => {
      const [, m, d] = key.split('-')
      return income('card_payout', verdierPayout(key), 5.5, {
        label: `VIR Encaissements boutique en ligne versement du ${d}/${m}`,
        counterparty: 'Encaissements boutique en ligne',
        category: 'sales', operationType: 'income', account: '707',
        reference: `PAYOUT-${key.replace(/-/g, '')}`,
      })
    },
  },
  {
    day: 1,
    build: (year, month) =>
      expense('rent', grossFromNet(950, 20), 20, {
        label: `VIR Foncière des Docks loyer entrepôt ${monthName(month)} ${year}`,
        counterparty: 'Foncière des Docks', category: 'rent',
        operationType: 'transfer', account: '6132',
      }),
  },
  {
    day: 2,
    build: () =>
      expense('bank_fee', 24, 20, {
        label: 'Abonnement compte professionnel', counterparty: 'Abonnement compte professionnel',
        category: 'fees', operationType: 'qonto_fee', account: '627',
      }),
  },
  {
    day: 3,
    build: (year, month) => {
      const prev = previousMonth(year, month)
      if (dateKeyOf(prev.year, prev.month, 1) < DEMO_EPOCH) return null
      const fees = round2(verdierMonthlyPayouts(prev.year, prev.month) * VERDIER_CARD_FEE_RATE)
      return expense('card_fees', fees, null, {
        label: `PRLV Frais d'encaissement CB ${monthName(prev.month)} ${prev.year}`,
        counterparty: 'Encaissements boutique en ligne', category: 'fees',
        operationType: 'direct_debit', account: '627', withReceipt: true,
      })
    },
  },
  {
    day: 4,
    build: () =>
      expense('subscription', 94.8, 20, {
        label: 'CB Plateforme boutique en ligne abonnement', counterparty: 'Plateforme boutique en ligne',
        category: 'online_service', operationType: 'card', account: '6135',
      }),
  },
  {
    day: 5,
    build: (year, month) => ({
      kind: 'urssaf',
      side: 'debit',
      amount: VERDIER_TNS_CONTRIBUTIONS,
      vatRate: null,
      label: `PRLV URSSAF cotisations TNS gérant ${monthName(month)} ${year}`,
      counterparty: 'URSSAF',
      category: 'tax',
      operationType: 'direct_debit',
      account: '646',
    }),
  },
  {
    day: 10,
    build: () =>
      expense('telecom', 35.99, 20, {
        label: 'PRLV Opérateur box et mobile pro', counterparty: 'Opérateur télécom',
        category: 'telecom', operationType: 'direct_debit', account: '626',
      }),
  },
  {
    day: 20,
    build: () =>
      expense('insurance', 89.4, null, {
        label: 'PRLV Assurance multirisque professionnelle', counterparty: 'Assurance multirisque',
        category: 'insurance', operationType: 'direct_debit', account: '616', withReceipt: true,
      }),
  },
  {
    day: 15,
    months: [12],
    build: () => ({
      kind: 'cfe',
      side: 'debit',
      amount: 312,
      vatRate: null,
      label: 'PRLV DGFIP CFE',
      counterparty: 'DGFiP',
      category: 'tax',
      operationType: 'direct_debit',
      account: '63511',
    }),
  },
]

const oneOffs = {
  [VERDIER_DISPLAY_CASE.date]: [
    expense('equipment', grossFromNet(VERDIER_DISPLAY_CASE.amountHT, 20), 20, {
      label: 'VIR Froid Équipement Pro vitrine réfrigérée', counterparty: 'Froid Équipement Pro',
      category: 'hardware_and_equipment', operationType: 'transfer',
      account: VERDIER_DISPLAY_CASE.account, vatAccount: '44562',
    }),
  ],
}

/** Year-end stock variation (PCG art. 946-60): opening stock reversed, closing stock booked. */
function periodEntries(year: number): LedgerEntry[] {
  const opening = VERDIER_STOCK[year - 1]
  const closing = VERDIER_STOCK[year]
  if (opening === undefined || closing === undefined) return []
  return [{
    journal: 'OD',
    date: dateKeyOf(year, 12, 31),
    description: `Variation des stocks de marchandises ${year}`,
    reference: `STOCK-${year}`,
    lines: [
      { account: '6037', debit: opening },
      { account: '37', credit: opening },
      { account: '37', debit: closing },
      { account: '6037', credit: closing },
    ],
  }]
}

export const MAISON_VERDIER_SPEC: ProfileSpec = {
  slug: VERDIER_SLUG,
  seed: 'kledg-demo-verdier',
  epoch: DEMO_EPOCH,
  daily: { mode: 'busy', max: 3 },
  randoms,
  schedules,
  oneOffs,
  vatMonthly: true,
  opening: {
    bank: 22000,
    vatDue: 1450,
    corporateTaxDue: 1800,
    corporateTaxInstalment: 2100,
    lines: withRetainedEarnings([
      { account: DEMO_BANK_LEDGER, debit: 22000 },
      { account: '37', debit: VERDIER_STOCK[2024] },
      { account: '1013', credit: 5000 },
      { account: '1061', credit: 500 },
      { account: '44551', credit: 1450 },
      { account: '444', credit: 1800 },
    ]),
  },
  fixedAssets: [VERDIER_DISPLAY_CASE],
  periodEntries,
}
