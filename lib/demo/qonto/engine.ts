/**
 * Deterministic bank activity and ledger engine for the demo companies.
 *
 * A company is described by a profile (see ./profiles): recurring scheduled
 * payments, one-offs, a pool of random day-to-day transactions, its opening
 * balances, its period-end entries (payroll, depreciation, stock) and its tax
 * regime. From that, the engine derives everything else, with no database
 * and no clock (callers pass dates):
 * - the bank transactions of any business day, from a PRNG seeded by the
 *   date only, so the simulated Qonto API, the demo seed and the tests agree,
 *   and each new day "reveals" new transactions;
 * - the monthly VAT return (CA3, réel normal) and its payment on the 19th of
 *   the following month, credits carried forward;
 * - the corporate tax (CGI art. 219: 15% up to 42,500 EUR, then 25%), four
 *   instalments (15/03, 15/06, 15/09, 15/12, none when the previous tax is
 *   below 3,000 EUR, CGI art. 1668) and the balance on 15/05;
 * - the full ledger of a fiscal year, as the seed books it.
 */

import { buildDepreciationPlan, sumPlanForPeriod } from '@/lib/fixed-assets/depreciation-plan'

/**
 * Ledger account of the demo bank accounts: 5121 "Comptes en euros" (PCG
 * art. 932-1). The class 512 is a parent that holds no entry; Kledg maps a
 * synced euro account to 5121 (lib/banking/ledger-code.ts).
 */
export const DEMO_BANK_LEDGER = '5121'

// ── Types ───────────────────────────────────────────────────────────────────

export type OperationType = 'income' | 'transfer' | 'card' | 'direct_debit' | 'qonto_fee'

/** One line of an accounting entry, by PCG code. */
export interface BookingLine {
  account: string
  debit?: number
  credit?: number
  description?: string
}

export interface DemoTransaction {
  /** UUID-like identifier (Qonto `id`). */
  id: string
  /** Qonto `transaction_id`, also used as accounting entry reference. */
  transactionId: string
  /** Profile slug of the company that owns the bank account. */
  profile: string
  /** Business date, YYYY-MM-DD. */
  date: string
  /** ISO 8601 settlement timestamp (UTC). */
  settledAt: string
  side: 'credit' | 'debit'
  /** Amount including VAT, positive, 2 decimals. */
  amount: number
  /** VAT rate in percent (20, 10, 5.5, 0) or null when out of scope. */
  vatRate: number | null
  /** VAT detected on the receipt (0 when none). */
  vatAmount: number
  label: string
  counterparty: string
  /** Qonto spending category. */
  category: string
  operationType: OperationType
  reference: string | null
  kind: string
  /** Main counterpart account (PCG code). */
  account: string
  /** VAT account booked, or null when no VAT is recovered or collected. */
  vatAccount: string | null
  /** Client invoice number settled by a client payment. */
  invoiceNumber: string | null
  /** Fake receipts exposed by /attachments. */
  attachmentIds: string[]
  /** Counterpart lines of the bank entry (the bank line, DEMO_BANK_LEDGER, is added by the ledger). */
  booking: BookingLine[]
}

/** A transaction before ids, time and booking are derived. */
export interface Draft {
  kind: string
  side: 'credit' | 'debit'
  amount: number
  vatRate: number | null
  label: string
  counterparty: string
  category: string
  operationType: OperationType
  account: string
  vatAccount?: string
  reference?: string
  invoiceNumber?: string
  withReceipt?: boolean
  /** False when the VAT shown on the receipt can't be recovered (company outside VAT). */
  recoverVat?: boolean
  /**
   * Share of the receipt's VAT that is deductible (1 by default): 0.8 for
   * fuel of a passenger car (CGI art. 298-4-1°). The rest stays in the
   * expense.
   */
  vatDeductibleShare?: number
  /** Explicit counterpart lines, instead of the net + VAT split. */
  lines?: BookingLine[]
}

/** Accounting entry booked outside the bank journal, or the opening entry. */
export interface LedgerEntry {
  journal: 'AN' | 'BQ' | 'OD'
  date: string
  description: string
  reference: string
  lines: BookingLine[]
  /** Bank transaction settled by the entry (BQ journal only). */
  transactionId?: string
}

export interface FixedAssetSpec {
  label: string
  comment: string
  /** Acquisition (and depreciation start) date. */
  date: string
  amountHT: number
  durationYears: number
  account: string
  depreciationAccount: string
  expenseAccount: string
}

export interface Schedule {
  /** Day of month (moved to the next business day, or the previous one at month end). */
  day?: number
  /** Or: every such weekday (1 = Monday ... 5 = Friday), when a business day. */
  weekdays?: number[]
  months?: number[]
  build: (year: number, month: number, key: string) => Draft | null
}

export interface RandomCategory {
  weight: number
  make: (rng: () => number, key: string, index: number) => Draft
}

export interface OpeningBalances {
  bank: number
  /** VAT of the last month before the epoch, paid on the 19th of the first month. */
  vatDue: number
  /** Corporate tax balance of the year before the epoch, paid on 15 May. */
  corporateTaxDue: number
  /** Instalments paid during the first year (based on the tax of the year before). */
  corporateTaxInstalment: number
  /** Opening entry lines (must balance; the bank line is included). */
  lines: BookingLine[]
}

export interface ProfileSpec {
  slug: string
  /** Prefix of the PRNG seeds. */
  seed: string
  epoch: string
  /**
   * Day-to-day activity. "busy": 1 to `max` transactions per business day,
   * random ones filling the gap left by scheduled ones (at least one a day).
   * "sparse": one random transaction with the given probability.
   */
  daily: { mode: 'busy'; max: number } | { mode: 'sparse'; probability: number }
  randoms: RandomCategory[]
  schedules: Schedule[]
  oneOffs?: Record<string, Draft[]>
  /** Monthly VAT return (réel normal). False for companies outside VAT. */
  vatMonthly: boolean
  opening: OpeningBalances
  fixedAssets?: FixedAssetSpec[]
  /** Payments that don't hit the income statement, placed before the tax ones (e.g. URSSAF on payroll). */
  socialDrafts?: (key: string, year: number, month: number) => Draft[]
  /**
   * Dated non-bank entries of a year other than VAT, depreciation and corporate
   * tax. `previous` is the income statement of the year before (null for the
   * epoch year), for the allocation of its result.
   */
  periodEntries?: (year: number, previous: FiscalYearSummary | null) => LedgerEntry[]
  /** Amount deducted from the accounting result to get the taxable income (e.g. parent-subsidiary regime). */
  taxDeduction?: (year: number) => number
}

export interface MonthlyVat {
  year: number
  month: number
  collected: number
  deductibleServices: number
  deductibleAssets: number
  carryIn: number
  /** VAT to pay for the month (0 when in credit). */
  due: number
  /** Credit carried to the next month. */
  carryOut: number
}

export interface FiscalYearSummary {
  year: number
  /** Turnover (accounts 70, net of VAT). */
  revenue: number
  /** Other income (accounts 71 to 79). */
  otherIncome: number
  /** Charges (class 6, corporate tax excluded). */
  charges: number
  depreciation: number
  resultBeforeTax: number
  taxableIncome: number
  corporateTax: number
  netResult: number
}

// ── Date helpers (UTC, YYYY-MM-DD) ──────────────────────────────────────────

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key)
  d.setUTCDate(d.getUTCDate() + days)
  return toDateKey(d)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function dateKeyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function lastDayOfMonth(year: number, month: number): string {
  return dateKeyOf(year, month, daysInMonth(year, month))
}

/** Easter Sunday (anonymous Gregorian algorithm), as YYYY-MM-DD. */
function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return dateKeyOf(year, month, day)
}

const holidayCache = new Map<number, Set<string>>()

/** French public holidays (Code du travail art. L3133-1). */
export function frenchPublicHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const set = new Set([
    dateKeyOf(year, 1, 1),
    addDays(easter, 1), // Lundi de Pâques
    dateKeyOf(year, 5, 1),
    dateKeyOf(year, 5, 8),
    addDays(easter, 39), // Ascension
    addDays(easter, 50), // Lundi de Pentecôte
    dateKeyOf(year, 7, 14),
    dateKeyOf(year, 8, 15),
    dateKeyOf(year, 11, 1),
    dateKeyOf(year, 11, 11),
    dateKeyOf(year, 12, 25),
  ])
  holidayCache.set(year, set)
  return set
}

export function isBusinessDay(key: string): boolean {
  const d = parseDateKey(key)
  const weekday = d.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !frenchPublicHolidays(d.getUTCFullYear()).has(key)
}

/**
 * Business day on which a monthly event targeted at `day` happens: the first
 * business day on or after it, or the last one before it at the end of month.
 */
export function scheduledBusinessDay(year: number, month: number, day: number): string {
  const last = daysInMonth(year, month)
  for (let d = Math.min(day, last); d <= last; d++) {
    const key = dateKeyOf(year, month, d)
    if (isBusinessDay(key)) return key
  }
  for (let d = Math.min(day, last) - 1; d >= 1; d--) {
    const key = dateKeyOf(year, month, d)
    if (isBusinessDay(key)) return key
  }
  return dateKeyOf(year, month, Math.min(day, last))
}

export function monthName(month: number): string {
  return [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ][month - 1]
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

// ── Numbers and PRNG ────────────────────────────────────────────────────────

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function hashString(input: string): number {
  // FNV-1a, 32 bits
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, good enough for fake data. */
export function createRng(seed: string): () => number {
  let a = hashString(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

export function between(rng: () => number, min: number, max: number): number {
  return round2(min + rng() * (max - min))
}

/** Deterministic UUID-shaped identifier. */
export function fakeUuid(seed: string): string {
  const rng = createRng(seed)
  const hex = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Splits a VAT-inclusive amount into net + VAT. */
export function vatFromGross(gross: number, rate: number | null): number {
  if (!rate) return 0
  return round2(gross - gross / (1 + rate / 100))
}

export function grossFromNet(net: number, rate: number): number {
  return round2(net * (1 + rate / 100))
}

/** Corporate tax: 15% up to 42,500 EUR, 25% above (CGI art. 219, PME rate). */
export function computeCorporateTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0
  const reduced = Math.min(taxableIncome, 42500) * 0.15
  const normal = Math.max(0, taxableIncome - 42500) * 0.25
  return Math.round(reduced + normal)
}

/** An outgoing payment, VAT deductible on services by default. */
export function expense(
  kind: string,
  gross: number,
  vatRate: number | null,
  rest: Omit<Draft, 'kind' | 'side' | 'amount' | 'vatRate'>
): Draft {
  return {
    kind,
    side: 'debit',
    amount: round2(gross),
    vatRate,
    vatAccount: vatRate ? rest.vatAccount ?? '44566' : undefined,
    withReceipt: rest.withReceipt ?? vatRate !== null,
    ...rest,
  }
}

/** An incoming payment of a sale, VAT collected (services: on receipts, CGI art. 269-2-c). */
export function income(
  kind: string,
  gross: number,
  vatRate: number | null,
  rest: Omit<Draft, 'kind' | 'side' | 'amount' | 'vatRate'>
): Draft {
  return {
    kind,
    side: 'credit',
    amount: round2(gross),
    vatRate,
    vatAccount: vatRate ? rest.vatAccount ?? '44571' : undefined,
    ...rest,
  }
}

/** Total debit minus total credit of lines. */
export function lineBalance(lines: BookingLine[]): number {
  return round2(lines.reduce((sum, l) => sum + (l.debit ?? 0) - (l.credit ?? 0), 0)) || 0
}

/** VAT of a draft that is booked as deductible or collected (0 when none). */
export function recoveredVatOf(draft: Pick<Draft, 'amount' | 'vatRate' | 'recoverVat' | 'vatDeductibleShare'>): number {
  if (draft.recoverVat === false) return 0
  // The VAT of the deductible share of the amount: the same computation as a
  // rule that splits the amount by percentages (lib/demo/companies.ts).
  return vatFromGross(draft.amount * (draft.vatDeductibleShare ?? 1), draft.vatRate)
}

/** Counterpart lines of a draft (everything but the bank line). */
export function bookingOf(draft: Draft): BookingLine[] {
  if (draft.lines) return draft.lines
  const vat = recoveredVatOf(draft)
  const net = round2(draft.amount - vat)
  const side = (amount: number) => (draft.side === 'credit' ? { credit: amount } : { debit: amount })
  const lines: BookingLine[] = [{ account: draft.account, ...side(net) }]
  if (vat > 0) lines.push({ account: draft.vatAccount ?? (draft.side === 'credit' ? '44571' : '44566'), ...side(vat) })
  return lines
}

// ── Engine ──────────────────────────────────────────────────────────────────

const VAT_COLLECTED = '44571'
const VAT_ON_ASSETS = '44562'
const VAT_DEDUCTIBLE = new Set(['44566', '44562'])

export class DemoProfileEngine {
  private readonly totalWeight: number
  private readonly baseCache = new Map<string, Draft[]>()
  private readonly vatCache = new Map<string, MonthlyVat>()
  private readonly summaryCache = new Map<number, FiscalYearSummary>()

  constructor(readonly spec: ProfileSpec) {
    this.totalWeight = spec.randoms.reduce((sum, c) => sum + c.weight, 0)
  }

  get slug(): string {
    return this.spec.slug
  }

  private randomDraft(rng: () => number, key: string, index: number): Draft {
    let roll = rng() * this.totalWeight
    for (const category of this.spec.randoms) {
      roll -= category.weight
      if (roll < 0) return category.make(rng, key, index)
    }
    return this.spec.randoms[0].make(rng, key, index)
  }

  /** Scheduled, one-off and random transactions of a day (no tax payments). */
  baseDrafts(key: string): Draft[] {
    const cached = this.baseCache.get(key)
    if (cached) return cached
    const drafts = this.computeBaseDrafts(key)
    this.baseCache.set(key, drafts)
    return drafts
  }

  private computeBaseDrafts(key: string): Draft[] {
    if (key < this.spec.epoch || !isBusinessDay(key)) return []
    const year = Number(key.slice(0, 4))
    const month = Number(key.slice(5, 7))
    const weekday = parseDateKey(key).getUTCDay()

    const drafts: Draft[] = []
    for (const schedule of this.spec.schedules) {
      if (schedule.months && !schedule.months.includes(month)) continue
      if (schedule.weekdays) {
        if (!schedule.weekdays.includes(weekday)) continue
      } else if (scheduledBusinessDay(year, month, schedule.day ?? 1) !== key) {
        continue
      }
      const draft = schedule.build(year, month, key)
      if (draft) drafts.push(draft)
    }
    drafts.push(...(this.spec.oneOffs?.[key] ?? []))

    const rng = createRng(`${this.spec.seed}:${key}`)
    if (this.spec.daily.mode === 'busy') {
      const target = 1 + Math.floor(rng() * this.spec.daily.max)
      // Random transactions fill the day up to the target, counting the tax
      // payments of the day; every business day gets at least one of its own.
      const taxCount = this.taxDrafts(key, true).length
      const randomCount = Math.max(drafts.length === 0 ? 1 : 0, target - drafts.length - taxCount)
      for (let i = 0; i < randomCount; i++) drafts.push(this.randomDraft(rng, key, drafts.length))
    } else if (this.spec.randoms.length > 0 && rng() < this.spec.daily.probability) {
      drafts.push(this.randomDraft(rng, key, drafts.length))
    }
    return drafts
  }

  /** VAT position of a month (CA3), from the generated receipts and purchases. */
  monthlyVat(year: number, month: number): MonthlyVat {
    const cacheKey = `${year}-${month}`
    const cached = this.vatCache.get(cacheKey)
    if (cached) return cached

    const firstOfMonth = dateKeyOf(year, month, 1)
    let carryIn = 0
    if (firstOfMonth > this.spec.epoch) {
      const prev = previousMonth(year, month)
      carryIn = this.monthlyVat(prev.year, prev.month).carryOut
    }

    let collected = 0
    let deductibleServices = 0
    let deductibleAssets = 0
    if (this.spec.vatMonthly) {
      for (let d = 1; d <= daysInMonth(year, month); d++) {
        for (const draft of this.baseDrafts(dateKeyOf(year, month, d))) {
          for (const line of bookingOf(draft)) {
            const amount = (line.debit ?? 0) - (line.credit ?? 0)
            if (line.account === VAT_COLLECTED) collected -= amount
            else if (line.account === VAT_ON_ASSETS) deductibleAssets += amount
            else if (VAT_DEDUCTIBLE.has(line.account)) deductibleServices += amount
          }
        }
      }
    }
    collected = round2(collected)
    deductibleServices = round2(deductibleServices)
    deductibleAssets = round2(deductibleAssets)
    const net = round2(collected - deductibleServices - deductibleAssets - carryIn)
    const result: MonthlyVat = {
      year,
      month,
      collected,
      deductibleServices,
      deductibleAssets,
      carryIn,
      due: net > 0 ? net : 0,
      carryOut: net < 0 ? -net : 0,
    }
    this.vatCache.set(cacheKey, result)
    return result
  }

  /** Depreciation of the profile's fixed assets over a calendar year, per asset. */
  depreciation(year: number): Array<{ asset: FixedAssetSpec; amount: number }> {
    return (this.spec.fixedAssets ?? []).map((asset) => {
      const plan = buildDepreciationPlan({
        acquisitionValue: asset.amountHT,
        amortizableAmount: asset.amountHT,
        depreciationMethod: 'linear',
        depreciationRate: null,
        depreciationDuration: asset.durationYears,
        decliningCoefficient: null,
        depreciationStartDate: parseDateKey(asset.date),
      })
      const amount = sumPlanForPeriod(plan, new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31)))
      return { asset, amount: round2(amount) }
    })
  }

  /** Entries other than bank, VAT and corporate tax of a year: period entries and depreciation. */
  private otherEntries(year: number): LedgerEntry[] {
    const previous = year > this.epochYear ? this.summary(year - 1) : null
    const entries = [...(this.spec.periodEntries?.(year, previous) ?? [])]
    for (const { asset, amount } of this.depreciation(year)) {
      if (amount <= 0) continue
      entries.push({
        journal: 'OD',
        date: dateKeyOf(year, 12, 31),
        description: `Dotation aux amortissements ${year} - ${asset.label}`,
        reference: `AMORT-${year}-${asset.account}`,
        lines: [
          { account: asset.expenseAccount, debit: amount },
          { account: asset.depreciationAccount, credit: amount },
        ],
      })
    }
    return entries
  }

  /** Income statement of a calendar fiscal year, as the seed books it. */
  summary(year: number): FiscalYearSummary {
    const cached = this.summaryCache.get(year)
    if (cached) return cached
    let revenue = 0
    let otherIncome = 0
    let charges = 0
    const add = (line: BookingLine) => {
      const amount = (line.debit ?? 0) - (line.credit ?? 0)
      if (line.account.startsWith('70')) revenue -= amount
      else if (line.account.startsWith('7')) otherIncome -= amount
      else if (line.account.startsWith('6')) charges += amount
    }
    let key = dateKeyOf(year, 1, 1)
    const end = dateKeyOf(year, 12, 31)
    while (key <= end) {
      for (const draft of this.baseDrafts(key)) bookingOf(draft).forEach(add)
      key = addDays(key, 1)
    }
    for (const entry of this.otherEntries(year)) entry.lines.forEach(add)
    revenue = round2(revenue)
    otherIncome = round2(otherIncome)
    charges = round2(charges)
    const depreciation = round2(this.depreciation(year).reduce((s, d) => s + d.amount, 0))
    const resultBeforeTax = round2(revenue + otherIncome - charges)
    const taxableIncome = round2(resultBeforeTax - (this.spec.taxDeduction?.(year) ?? 0))
    const corporateTax = computeCorporateTax(taxableIncome)
    const summary: FiscalYearSummary = {
      year,
      revenue,
      otherIncome,
      charges,
      depreciation,
      resultBeforeTax,
      taxableIncome,
      corporateTax,
      netResult: round2(resultBeforeTax - corporateTax),
    }
    this.summaryCache.set(year, summary)
    return summary
  }

  private get epochYear(): number {
    return Number(this.spec.epoch.slice(0, 4))
  }

  /** Quarterly corporate tax instalment for a year (CGI art. 1668). */
  corporateTaxInstalment(year: number): number {
    if (year <= this.epochYear) return this.spec.opening.corporateTaxInstalment
    const previousTax = this.summary(year - 1).corporateTax
    // No instalments when the previous tax is below 3,000 EUR.
    return previousTax < 3000 ? 0 : Math.round(previousTax / 4)
  }

  /** Corporate tax balance paid (positive) or refunded (negative) on 15 May. */
  corporateTaxBalance(year: number): number {
    if (year <= this.epochYear) return this.spec.opening.corporateTaxDue
    const previousTax = this.summary(year - 1).corporateTax
    return round2(previousTax - 4 * this.corporateTaxInstalment(year - 1))
  }

  /**
   * Social and tax payments of a day. With `countOnly`, skips the amount
   * computation (used while generating the base drafts, which must not depend
   * on tax amounts).
   */
  taxDrafts(key: string, countOnly = false): Draft[] {
    if (key < this.spec.epoch || !isBusinessDay(key)) return []
    const year = Number(key.slice(0, 4))
    const month = Number(key.slice(5, 7))
    const drafts: Draft[] = [...(this.spec.socialDrafts?.(key, year, month) ?? [])]

    if (this.spec.vatMonthly && scheduledBusinessDay(year, month, 19) === key) {
      const prev = previousMonth(year, month)
      const due = countOnly
        ? 1
        : dateKeyOf(prev.year, prev.month, 1) < this.spec.epoch
          ? this.spec.opening.vatDue
          : this.monthlyVat(prev.year, prev.month).due
      if (due > 0) {
        drafts.push({
          kind: 'vat_payment',
          side: 'debit',
          amount: due,
          vatRate: null,
          label: `PRLV DGFIP TVA ${monthName(prev.month)} ${prev.year}`,
          counterparty: 'DGFiP',
          category: 'tax',
          operationType: 'direct_debit',
          account: '44551',
        })
      }
    }

    if ([3, 6, 9, 12].includes(month) && scheduledBusinessDay(year, month, 15) === key) {
      const amount = countOnly ? 1 : this.corporateTaxInstalment(year)
      if (amount > 0) {
        drafts.push({
          kind: 'corporate_tax',
          side: 'debit',
          amount,
          vatRate: null,
          label: `PRLV DGFIP IS acompte ${[3, 6, 9, 12].indexOf(month) + 1}/4 ${year}`,
          counterparty: 'DGFiP',
          category: 'tax',
          operationType: 'direct_debit',
          account: '444',
        })
      }
    }

    if (month === 5 && scheduledBusinessDay(year, month, 15) === key) {
      const balance = countOnly ? 1 : this.corporateTaxBalance(year)
      if (balance !== 0) {
        drafts.push({
          kind: 'corporate_tax',
          side: balance > 0 ? 'debit' : 'credit',
          amount: Math.abs(balance),
          vatRate: null,
          label: balance > 0 ? `PRLV DGFIP IS solde ${year - 1}` : `VIR DGFIP remboursement excédent IS ${year - 1}`,
          counterparty: 'DGFiP',
          category: 'tax',
          operationType: balance > 0 ? 'direct_debit' : 'income',
          account: '444',
        })
      }
    }

    return drafts
  }

  /** All transactions of a day (empty on weekends and public holidays). */
  transactionsForDay(key: string): DemoTransaction[] {
    const drafts = [...this.baseDrafts(key), ...this.taxDrafts(key)]
    const rng = createRng(`${this.spec.seed}-time:${key}`)
    const compact = key.replace(/-/g, '')
    return drafts.map((draft, index) => {
      const transactionId = `${this.spec.slug}-${compact}-${index + 1}`
      const vatAmount = vatFromGross(draft.amount, draft.vatRate)
      const recovered = recoveredVatOf(draft) > 0
      return {
        id: fakeUuid(transactionId),
        transactionId,
        profile: this.spec.slug,
        date: key,
        settledAt: settlementTime(key, index, drafts.length, rng),
        side: draft.side,
        amount: round2(draft.amount),
        vatRate: draft.vatRate,
        vatAmount,
        label: draft.label,
        counterparty: draft.counterparty,
        category: draft.category,
        operationType: draft.operationType,
        reference: draft.reference ?? null,
        kind: draft.kind,
        account: draft.account,
        vatAccount: recovered ? draft.vatAccount ?? (draft.side === 'credit' ? VAT_COLLECTED : '44566') : null,
        invoiceNumber: draft.invoiceNumber ?? null,
        attachmentIds: draft.withReceipt ? [fakeUuid(`receipt:${transactionId}`)] : [],
        booking: bookingOf(draft),
      }
    })
  }

  /** Transactions settled in [from, to] (inclusive date keys), oldest first. */
  transactions(from: string, to: string): DemoTransaction[] {
    const result: DemoTransaction[] = []
    let key = from < this.spec.epoch ? this.spec.epoch : from
    while (key <= to) {
      result.push(...this.transactionsForDay(key))
      key = addDays(key, 1)
    }
    return result
  }

  /** Bank balance after all transactions settled at or before `now`. */
  balance(now: Date): number {
    const nowIso = now.toISOString()
    let balance = this.spec.opening.bank
    for (const tx of this.transactions(this.spec.epoch, toDateKey(now))) {
      if (tx.settledAt <= nowIso) balance += signedAmount(tx)
    }
    return round2(balance)
  }

  /** The CA3 entry of a month (VAT accounts cleared to 44551, or credit carried in 44567). */
  vatEntry(year: number, month: number): LedgerEntry | null {
    if (!this.spec.vatMonthly) return null
    const vat = this.monthlyVat(year, month)
    const net = round2(vat.collected - vat.deductibleServices - vat.deductibleAssets - vat.carryIn)
    const label = `${String(month).padStart(2, '0')}/${year}`
    return {
      journal: 'OD',
      date: lastDayOfMonth(year, month),
      description: `Déclaration de TVA CA3 ${label}`,
      reference: `TVA-${year}-${String(month).padStart(2, '0')}`,
      lines: [
        { account: '44571', debit: vat.collected },
        { account: '44566', credit: vat.deductibleServices },
        { account: '44562', credit: vat.deductibleAssets },
        { account: '44567', credit: vat.carryIn },
        net > 0 ? { account: '44551', credit: net } : { account: '44567', debit: -net },
      ],
    }
  }

  /**
   * Every entry of a fiscal year (calendar year) dated up to `to`, in date
   * order: opening entry (first year only), bank entries, month-end entries,
   * year-end entries and corporate tax.
   */
  ledger(year: number, to: string = dateKeyOf(year, 12, 31)): LedgerEntry[] {
    const start = dateKeyOf(year, 1, 1)
    const end = to < dateKeyOf(year, 12, 31) ? to : dateKeyOf(year, 12, 31)
    const entries: LedgerEntry[] = []
    if (start <= this.spec.epoch && this.spec.epoch <= end) {
      entries.push({
        journal: 'AN',
        date: this.spec.epoch,
        description: `Reprise des soldes au ${addDays(this.spec.epoch, -1).split('-').reverse().join('/')}`,
        reference: `AN-${year}`,
        lines: this.spec.opening.lines,
      })
    }
    for (const tx of this.transactions(start, end)) {
      entries.push({
        journal: 'BQ',
        date: tx.date,
        description: tx.label,
        reference: tx.transactionId,
        transactionId: tx.transactionId,
        lines: [
          { account: DEMO_BANK_LEDGER, ...(tx.side === 'credit' ? { debit: tx.amount } : { credit: tx.amount }) },
          ...tx.booking,
        ],
      })
    }
    const others = [...this.otherEntries(year)]
    for (let month = 1; month <= 12; month++) {
      const vat = this.vatEntry(year, month)
      if (vat) others.push(vat)
    }
    const summary = this.summary(year)
    if (summary.corporateTax > 0) {
      others.push({
        journal: 'OD',
        date: dateKeyOf(year, 12, 31),
        description: `Impôt sur les sociétés ${year}`,
        reference: `IS-${year}`,
        lines: [
          { account: '695', debit: summary.corporateTax },
          { account: '444', credit: summary.corporateTax },
        ],
      })
    }
    entries.push(...others.filter((e) => e.date >= start && e.date <= end))
    // Stable sort by date: same-day entries keep bank first, then OD.
    return entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.index - b.index)
      .map(({ entry }) => ({ ...entry, lines: entry.lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0) }))
  }

  /** Finds a generated transaction by `id` or `transaction_id` (within the API window). */
  find(idOrTransactionId: string, now: Date, historyDays: number): DemoTransaction | null {
    const prefix = `${this.spec.slug}-`
    if (idOrTransactionId.startsWith(prefix)) {
      const match = /^(\d{4})(\d{2})(\d{2})-\d+$/.exec(idOrTransactionId.slice(prefix.length))
      if (!match) return null
      const key = `${match[1]}-${match[2]}-${match[3]}`
      return this.transactionsForDay(key).find((t) => t.transactionId === idOrTransactionId) ?? null
    }
    const today = toDateKey(now)
    return this.transactions(addDays(today, -historyDays), today).find((t) => t.id === idOrTransactionId) ?? null
  }

  /** Finds the transaction that owns a receipt (within the API window). */
  findByAttachment(attachmentId: string, now: Date, historyDays: number): DemoTransaction | null {
    const today = toDateKey(now)
    return (
      this.transactions(addDays(today, -historyDays), today).find((t) => t.attachmentIds.includes(attachmentId)) ??
      null
    )
  }
}

function settlementTime(key: string, index: number, count: number, rng: () => number): string {
  // Spread over the banking day, 07:00 to 17:00 UTC, in order.
  const slot = 600 / count
  const minutes = Math.floor(420 + slot * index + rng() * slot * 0.8)
  const h = String(Math.floor(minutes / 60)).padStart(2, '0')
  const m = String(minutes % 60).padStart(2, '0')
  const s = String(Math.floor(rng() * 60)).padStart(2, '0')
  return `${key}T${h}:${m}:${s}.000Z`
}

/** Signed effect of a transaction on the bank balance. */
export function signedAmount(tx: Pick<DemoTransaction, 'side' | 'amount'>): number {
  return tx.side === 'credit' ? tx.amount : -tx.amount
}

/** Balances an opening entry with retained earnings (110 when positive, 119 when negative). */
export function withRetainedEarnings(lines: BookingLine[]): BookingLine[] {
  const balance = lineBalance(lines)
  if (balance === 0) return lines
  return [...lines, balance > 0 ? { account: '110', credit: balance } : { account: '119', debit: -balance }]
}
