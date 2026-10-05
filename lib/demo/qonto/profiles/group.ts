/**
 * The Lumen group: what Lumen Holding holds and the documents the companies
 * of the group exchange, in one place so that both sides of every flow book
 * the same thing (vue groupe, docs/vue-groupe.md). Pure: no database.
 *
 * The story, all fictional:
 * - Claire Vasseur founded Lumen Holding (SAS) on 3 June 2024 by contributing
 *   her 100 shares of Atelier Lumen (120,000 EUR), with her brother Marc
 *   Vasseur, who contributed his 40 parts of SCI Les Tilleuls (36,000 EUR,
 *   Hélène Garnier keeps the other 60);
 * - on 16 December 2024 Thomas Verdier contributed the 500 parts of Maison
 *   Verdier (84,000 EUR) to the holding. Maison Verdier stays an EURL, its
 *   sole partner being a company (Code de commerce art. L223-1; L223-5 only
 *   forbids an EURL as sole partner), and Thomas Verdier its gérant, unpaid
 *   (gérant non associé, mandat gratuit);
 * - the holding's capital is 240,000 EUR (24,000 shares of 10 EUR), held by
 *   natural persons only (lib/demo/people): Claire Vasseur 50 %, Thomas
 *   Verdier 35 %, Marc Vasseur 15 %, so the reduced corporate tax rate stays
 *   open to it (CGI art. 219, I, b). The titres are booked at their
 *   contribution value, one sub-account of 261 per company, named after it
 *   so that the participations table attributes them
 *   (lib/group/get-participations.service.ts);
 * - Atelier Lumen and Maison Verdier are filiales (more than 50 % of the
 *   capital, Code de commerce art. L233-1), SCI Les Tilleuls a participation
 *   (10 to 50 %, art. L233-2).
 *
 * Flows between the companies:
 * - management fees of the "Convention d'animation": 2,500 EUR excluding VAT
 *   a month, 60 % to Atelier Lumen and 40 % to Maison Verdier, invoiced on
 *   the first day of the month in the series LH-<year>-<sequence> (the
 *   holding pays VAT on debits, CGI art. 269, 2, c), received by each
 *   subsidiary as a purchase invoice (AC: 6226, 44566, 401) and paid on the
 *   25th;
 * - a current-account advance of the holding to Maison Verdier on 1 July 2025
 *   (451100 in the holding, 455100 in the subsidiary, both named after the
 *   other company) bearing 4 % a year, below the deductible rate (CGI art.
 *   39, 1, 3° and 212), invoiced each 31 December (exempt from VAT, CGI art.
 *   261 C, 1°, a: 7638 in the holding, 6615 in the subsidiary) and paid mid
 *   January;
 * - a design job of Atelier Lumen for Maison Verdier in October 2025 (the
 *   visual identity of the gift boxes): sales invoice with VAT on receipts
 *   (44574 until paid), purchase invoice on the other side;
 * - Atelier Lumen's dividends to the holding (shared.ts lumenDividend).
 */

import { formatVatRate } from '@/lib/invoices/amounts'
import { formatIsoDateFr } from '@/lib/utils/date'
import {
  grossFromNet,
  lastDayOfMonth,
  monthName,
  round2,
  scheduledBusinessDay,
  type BookingLine,
  type Draft,
  type LedgerEntry,
} from '../engine'

export const HOLDING_SLUG = 'lumen-holding'
export const LUMEN_SLUG = 'atelier-lumen'
export const VERDIER_SLUG = 'maison-verdier'
export const TILLEULS_SLUG = 'sci-les-tilleuls'

/** Names of the companies of the group, by profile slug (lib/demo/companies.ts). */
export const GROUP_NAMES: Readonly<Record<string, string>> = {
  [HOLDING_SLUG]: 'Lumen Holding',
  [LUMEN_SLUG]: 'Atelier Lumen',
  [VERDIER_SLUG]: 'Maison Verdier',
  [TILLEULS_SLUG]: 'SCI Les Tilleuls',
}

export const HOLDING_FOUNDER = 'Claire Vasseur'

export interface GroupStake {
  slug: string
  /** Share of the capital held by Lumen Holding, in percent. */
  percent: number
  /** Shares or parts held. */
  shares: number
  /** Nominal value of the shares held (the subsidiary's capital x percent). */
  capitalHeld: number
  /** Titres de participation in the holding's books, at their contribution value. */
  titres: { account: string; label: string; amount: number }
}

/** What Lumen Holding holds: the shareholder rows of each company and the 261 sub-accounts of the holding. */
export const GROUP_STAKES: readonly GroupStake[] = [
  { slug: LUMEN_SLUG, percent: 100, shares: 100, capitalHeld: 1000, titres: { account: '261100', label: 'Titres Atelier Lumen', amount: 120000 } },
  { slug: VERDIER_SLUG, percent: 100, shares: 500, capitalHeld: 5000, titres: { account: '261200', label: 'Titres Maison Verdier', amount: 84000 } },
  { slug: TILLEULS_SLUG, percent: 40, shares: 40, capitalHeld: 400, titres: { account: '261300', label: 'Titres SCI Les Tilleuls', amount: 36000 } },
]

/** Capital of Lumen Holding: the contributions (24,000 shares of 10 EUR). */
export const HOLDING_CAPITAL = GROUP_STAKES.reduce((sum, s) => sum + s.titres.amount, 0)

/** A sub-account a company adds to the PCG (PCG art. 932-1: the chart may be subdivided). */
export interface GroupAccount {
  code: string
  label: string
}

/** The current-account advance of Lumen Holding to Maison Verdier. */
export const VERDIER_ADVANCE = {
  date: '2025-07-01',
  amount: 15000,
  annualRate: 0.04,
  holdingAccount: { code: '451100', label: 'Compte courant Maison Verdier' },
  subsidiaryAccount: { code: '455100', label: 'Compte courant Lumen Holding' },
} as const

/**
 * Sub-accounts the group's flows need: those named after the other company
 * of the group, and 44574 for the VAT Atelier Lumen collects on receipt
 * (the account Kledg's invoice posting creates, lib/invoices/post-invoice.service.ts).
 */
export const GROUP_ACCOUNTS: Readonly<Record<string, readonly GroupAccount[]>> = {
  [HOLDING_SLUG]: [...GROUP_STAKES.map((s) => ({ code: s.titres.account, label: s.titres.label })), VERDIER_ADVANCE.holdingAccount],
  [LUMEN_SLUG]: [{ code: '44574', label: 'TVA collectée en attente d’encaissement' }],
  [VERDIER_SLUG]: [VERDIER_ADVANCE.subsidiaryAccount],
}

export interface GroupTiers {
  /** The company whose tiers it is. */
  books: string
  /** The other company of the group. */
  counterpart: string
  kind: 'CUSTOMER' | 'SUPPLIER'
  /** Auxiliary account number (FEC CompAuxNum), the one Kledg would give the company's first tiers of that kind. */
  aux: string
}

/** The tiers each company keeps for the others (their SIREN is the sandbox's, set by the seed). */
export const GROUP_TIERS: readonly GroupTiers[] = [
  { books: HOLDING_SLUG, counterpart: LUMEN_SLUG, kind: 'CUSTOMER', aux: 'C00001' },
  { books: HOLDING_SLUG, counterpart: VERDIER_SLUG, kind: 'CUSTOMER', aux: 'C00002' },
  { books: LUMEN_SLUG, counterpart: HOLDING_SLUG, kind: 'SUPPLIER', aux: 'F00001' },
  { books: LUMEN_SLUG, counterpart: VERDIER_SLUG, kind: 'CUSTOMER', aux: 'C00001' },
  { books: VERDIER_SLUG, counterpart: HOLDING_SLUG, kind: 'SUPPLIER', aux: 'F00001' },
  { books: VERDIER_SLUG, counterpart: LUMEN_SLUG, kind: 'SUPPLIER', aux: 'F00002' },
]

/** Auxiliary account of `counterpart` in the books of `books` (FEC CompAuxNum and CompAuxLib). */
export function groupAux(books: string, counterpart: string): { number: string; label: string } {
  const tiers = GROUP_TIERS.find((t) => t.books === books && t.counterpart === counterpart)
  if (!tiers) throw new Error(`No tiers for ${counterpart} in the books of ${books}`)
  return { number: tiers.aux, label: GROUP_NAMES[counterpart] }
}

// ── Management fees ─────────────────────────────────────────────────────────

/**
 * The "Convention d'animation" (lib/management-fees, FIXED pricing, CUSTOM
 * key): 2,500 EUR excluding VAT a month split 60 / 40, VAT 20 %, invoiced
 * on the first day of the month, paid on the 25th.
 */
export const MANAGEMENT_FEE = {
  totalNet: 2500,
  vatRate: 20,
  day: 25,
  convention: "Convention d'animation",
  invoicePrefix: 'LH',
  /** In the order of the convention: each month's invoices are numbered in this order. */
  subsidiaries: [
    { slug: LUMEN_SLUG, net: 1500, sharePercentBp: 6000 },
    { slug: VERDIER_SLUG, net: 1000, sharePercentBp: 4000 },
  ],
} as const

export type FeeSubsidiary = (typeof MANAGEMENT_FEE.subsidiaries)[number]

export function feeSubsidiary(slug: string): FeeSubsidiary {
  const found = MANAGEMENT_FEE.subsidiaries.find((s) => s.slug === slug)
  if (!found) throw new Error(`${slug} is not party to the management fee convention`)
  return found
}

/**
 * Number of a month's management fee invoice of a subsidiary: the series
 * numbers the subsidiaries of each month in the order of the convention, as
 * Kledg's billing does (lib/management-fees/bill-management-fees.service.ts).
 */
export function feeInvoiceNumber(year: number, month: number, slug: string): string {
  const index = MANAGEMENT_FEE.subsidiaries.findIndex((s) => s.slug === slug)
  if (index < 0) throw new Error(`${slug} is not party to the management fee convention`)
  const sequence = (month - 1) * MANAGEMENT_FEE.subsidiaries.length + index + 1
  return `${MANAGEMENT_FEE.invoicePrefix}-${year}-${String(sequence).padStart(3, '0')}`
}

/** Invoice date of a month's management fees (terme à échoir: the first day of the month). */
export function feeInvoiceDate(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/** Line label of a month's invoice: the label Kledg's billing gives it (bill-management-fees.service.ts lineLabel). */
export function feeLineLabel(year: number, month: number): string {
  const start = feeInvoiceDate(year, month)
  return `Prestations de services (convention « ${MANAGEMENT_FEE.convention} ») du ${formatIsoDateFr(start)} au ${formatIsoDateFr(lastDayOfMonth(year, month))}`
}

// ── Intragroup invoices ─────────────────────────────────────────────────────

export type GroupInvoiceKind = 'management_fee' | 'interest' | 'services'

/** An invoice between two companies of the group, as both book it. */
export interface GroupInvoice {
  number: string
  kind: GroupInvoiceKind
  seller: string
  buyer: string
  issueDate: string
  /** Business day of the transfer that settles it. */
  paymentDate: string
  /** Label of the invoice (the convention's for management fees). */
  label: string
  lineLabel: string
  net: number
  /** VAT rate in percent (0: exempt). */
  vatRate: number
  sellerAccount: string
  buyerAccount: string
  /** Services whose VAT the seller owes on receipt (CGI art. 269, 2, c): 44574 until paid. */
  sellerVatOnReceipts: boolean
  /** What the bank transfer says it pays. */
  transferPurpose: string
  /** Billed period (management fees). */
  period?: { start: string; end: string }
}

export function grossOf(invoice: Pick<GroupInvoice, 'net' | 'vatRate'>): number {
  return grossFromNet(invoice.net, invoice.vatRate)
}

export function vatOf(invoice: Pick<GroupInvoice, 'net' | 'vatRate'>): number {
  return round2(grossOf(invoice) - invoice.net)
}

/** A month's management fee invoice of a subsidiary. */
export function feeInvoice(year: number, month: number, sub: FeeSubsidiary): GroupInvoice {
  return {
    number: feeInvoiceNumber(year, month, sub.slug),
    kind: 'management_fee',
    seller: HOLDING_SLUG,
    buyer: sub.slug,
    issueDate: feeInvoiceDate(year, month),
    paymentDate: scheduledBusinessDay(year, month, MANAGEMENT_FEE.day),
    label: MANAGEMENT_FEE.convention,
    lineLabel: feeLineLabel(year, month),
    net: sub.net,
    vatRate: MANAGEMENT_FEE.vatRate,
    sellerAccount: '706',
    buyerAccount: '6226',
    sellerVatOnReceipts: false,
    transferPurpose: `management fees ${monthName(month)} ${year}`,
    period: { start: feeInvoiceDate(year, month), end: lastDayOfMonth(year, month) },
  }
}

/** Interest of the advance over a year: days from the advance (or 1 January) to 31 December, on 365 days. */
export function advanceInterest(year: number): number {
  const start = VERDIER_ADVANCE.date > `${year}-01-01` ? VERDIER_ADVANCE.date : `${year}-01-01`
  if (start > `${year}-12-31`) return 0
  const days = (Date.UTC(year, 11, 31) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1
  return round2((VERDIER_ADVANCE.amount * VERDIER_ADVANCE.annualRate * days) / 365)
}

/** The invoice of a year's interest on the advance, null before the advance. */
export function interestInvoice(year: number): GroupInvoice | null {
  const net = advanceInterest(year)
  if (net <= 0) return null
  return {
    number: `CC-${year}-001`,
    kind: 'interest',
    seller: HOLDING_SLUG,
    buyer: VERDIER_SLUG,
    issueDate: `${year}-12-31`,
    paymentDate: scheduledBusinessDay(year + 1, 1, 15),
    label: `Intérêts du compte courant ${year}`,
    lineLabel: `Intérêts du compte courant au taux de ${String(VERDIER_ADVANCE.annualRate * 100).replace('.', ',')} % du ${formatIsoDateFr(VERDIER_ADVANCE.date > `${year}-01-01` ? VERDIER_ADVANCE.date : `${year}-01-01`)} au ${formatIsoDateFr(`${year}-12-31`)}, exonérés de TVA (CGI art. 261 C, 1°, a)`,
    net,
    vatRate: 0,
    sellerAccount: '7638',
    buyerAccount: '6615',
    sellerVatOnReceipts: false,
    transferPurpose: `intérêts compte courant ${year}`,
  }
}

/** The design job of Atelier Lumen for Maison Verdier. */
export const DESIGN_INVOICE: GroupInvoice = {
  number: 'FA-2025-1006-MV',
  kind: 'services',
  seller: LUMEN_SLUG,
  buyer: VERDIER_SLUG,
  issueDate: '2025-10-06',
  paymentDate: scheduledBusinessDay(2025, 10, 31),
  label: 'Identité visuelle des coffrets cadeaux',
  lineLabel: 'Création de l’identité visuelle et des étiquettes des coffrets cadeaux de fin d’année',
  net: 3600,
  vatRate: 20,
  sellerAccount: '706',
  buyerAccount: '6226',
  sellerVatOnReceipts: true,
  transferPurpose: 'facture',
}

const invoiceCache = new Map<number, GroupInvoice[]>()

/** Every invoice between companies of the group issued in a year, by issue date. */
export function groupInvoices(year: number): GroupInvoice[] {
  const cached = invoiceCache.get(year)
  if (cached) return cached
  const invoices: GroupInvoice[] = []
  if (year >= 2025) {
    for (let month = 1; month <= 12; month++) {
      for (const sub of MANAGEMENT_FEE.subsidiaries) invoices.push(feeInvoice(year, month, sub))
    }
    if (DESIGN_INVOICE.issueDate.startsWith(String(year))) invoices.push(DESIGN_INVOICE)
    const interest = interestInvoice(year)
    if (interest) invoices.push(interest)
  }
  const sorted = invoices.map((invoice, index) => ({ invoice, index })).sort((a, b) => a.invoice.issueDate.localeCompare(b.invoice.issueDate) || a.index - b.index)
  const result = sorted.map(({ invoice }) => invoice)
  invoiceCache.set(year, result)
  return result
}

/** The invoices of a year one company is party to. */
export function invoicesOf(slug: string, year: number): GroupInvoice[] {
  return groupInvoices(year).filter((i) => i.seller === slug || i.buyer === slug)
}

/** The invoices paid on a day (issued that year or the year before). */
export function invoicesPaidOn(key: string): GroupInvoice[] {
  const year = Number(key.slice(0, 4))
  return [...groupInvoices(year - 1), ...groupInvoices(year)].filter((i) => i.paymentDate === key)
}

// ── Bank transfers ──────────────────────────────────────────────────────────

/** The seller's side of the transfer: its customer account (411, the buyer's auxiliary account) settled. */
export function receiptDraft(invoice: GroupInvoice): Draft {
  const gross = grossOf(invoice)
  return {
    kind: invoice.kind === 'management_fee' ? 'management_fees' : 'intragroup_invoice',
    side: 'credit',
    amount: gross,
    vatRate: null,
    label: `VIR ${GROUP_NAMES[invoice.buyer].toUpperCase()} ${invoice.transferPurpose} ${invoice.number}`,
    counterparty: GROUP_NAMES[invoice.buyer],
    category: invoice.kind === 'interest' ? 'other_income' : 'sales',
    operationType: 'income',
    account: '411',
    reference: invoice.number,
    invoiceNumber: invoice.number,
    lines: [{ account: '411', credit: gross, auxiliary: groupAux(invoice.seller, invoice.buyer) }],
  }
}

/** The buyer's side: its supplier account (401, the seller's auxiliary account) settled. */
export function paymentDraft(invoice: GroupInvoice): Draft {
  const gross = grossOf(invoice)
  return {
    kind: invoice.kind === 'management_fee' ? 'management_fees' : 'intragroup_invoice',
    side: 'debit',
    amount: gross,
    vatRate: null,
    label: `VIR ${GROUP_NAMES[invoice.seller]} ${invoice.transferPurpose} ${invoice.number}`,
    counterparty: GROUP_NAMES[invoice.seller],
    category: invoice.kind === 'interest' ? 'finance' : 'other_service',
    operationType: 'transfer',
    account: '401',
    reference: invoice.number,
    withReceipt: true,
    lines: [{ account: '401', debit: gross, auxiliary: groupAux(invoice.buyer, invoice.seller) }],
  }
}

/** The advance, both sides: the holding's transfer and the subsidiary's receipt. */
export function advanceDrafts(slug: string): Record<string, Draft[]> {
  const { date, amount, holdingAccount, subsidiaryAccount } = VERDIER_ADVANCE
  if (slug === HOLDING_SLUG) {
    return {
      [date]: [{
        kind: 'current_account',
        side: 'debit',
        amount,
        vatRate: null,
        label: 'VIR Maison Verdier avance en compte courant',
        counterparty: GROUP_NAMES[VERDIER_SLUG],
        category: 'finance',
        operationType: 'transfer',
        account: holdingAccount.code,
        reference: `AVANCE-${date.slice(0, 4)}`,
      }],
    }
  }
  if (slug === VERDIER_SLUG) {
    return {
      [date]: [{
        kind: 'current_account',
        side: 'credit',
        amount,
        vatRate: null,
        label: 'VIR LUMEN HOLDING avance en compte courant',
        counterparty: GROUP_NAMES[HOLDING_SLUG],
        category: 'finance',
        operationType: 'income',
        account: subsidiaryAccount.code,
        reference: `AVANCE-${date.slice(0, 4)}`,
      }],
    }
  }
  return {}
}

// ── Invoice entries ─────────────────────────────────────────────────────────

/**
 * The entries of the intragroup invoices of a company for a year, as Kledg's
 * invoice module posts them (lib/invoices/posting-plan.ts): sales in VE
 * (411 debited with the total, revenue and VAT credited), purchases in AC
 * (expense and deductible VAT debited, 401 credited), each with the other
 * company's auxiliary account; and, for a sale whose VAT is due on receipt,
 * the transfer of that VAT from 44574 to 44571 on the day it is paid
 * (lib/invoices/invoice-payments.service.ts).
 */
export function groupInvoiceEntries(slug: string, year: number): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (const invoice of invoicesOf(slug, year)) {
    const gross = grossOf(invoice)
    const vat = vatOf(invoice)
    const vatLabel = (description: string) => `${description}, TVA ${formatVatRate(invoice.vatRate * 100)}`
    if (invoice.seller === slug) {
      const description = `Facture ${invoice.number} ${GROUP_NAMES[invoice.buyer]}`
      const lines: BookingLine[] = [
        { account: '411', debit: gross, description, auxiliary: groupAux(slug, invoice.buyer) },
        { account: invoice.sellerAccount, credit: invoice.net, description: invoice.lineLabel },
      ]
      if (vat > 0) {
        lines.push(
          invoice.sellerVatOnReceipts
            ? { account: '44574', credit: vat, description: `${vatLabel(description)} en attente d’encaissement` }
            : { account: '44571', credit: vat, description: vatLabel(description) },
        )
      }
      entries.push({ journal: 'VE', date: invoice.issueDate, description, reference: invoice.number, lines })
    } else {
      const description = `Facture ${invoice.number} ${GROUP_NAMES[invoice.seller]}`
      const lines: BookingLine[] = [
        { account: '401', credit: gross, description, auxiliary: groupAux(slug, invoice.seller) },
        { account: invoice.buyerAccount, debit: invoice.net, description: invoice.lineLabel },
      ]
      if (vat > 0) lines.push({ account: '44566', debit: vat, description: vatLabel(description) })
      entries.push({ journal: 'AC', date: invoice.issueDate, description, reference: invoice.number, lines })
    }
  }
  // VAT on receipts: collected when paid, in the year of the payment.
  for (const invoice of [...groupInvoices(year - 1), ...groupInvoices(year)]) {
    if (invoice.seller !== slug || !invoice.sellerVatOnReceipts || !invoice.paymentDate.startsWith(String(year))) continue
    const vat = vatOf(invoice)
    if (vat <= 0) continue
    entries.push({
      journal: 'OD',
      date: invoice.paymentDate,
      description: `TVA encaissée sur la facture ${invoice.number}`,
      reference: vatTransferReference(invoice.number),
      lines: [
        { account: '44574', debit: vat },
        { account: '44571', credit: vat },
      ],
    })
  }
  return entries
}

/** Reference of the entry that moves an invoice's VAT on receipt to 44571. */
export function vatTransferReference(number: string): string {
  return `TVA-ENC-${number}`
}
