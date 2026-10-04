import { describe, expect, it } from 'vitest'
import {
  addDays,
  computeCorporateTax,
  isBusinessDay,
  lineBalance,
  round2,
  vatFromGross,
  type DemoTransaction,
  type LedgerEntry,
} from '../qonto/engine'
import { DEMO_PROFILES, profileBySlug } from '../qonto/profiles'
import { LUMEN_MANAGEMENT_FEE, isValidIban, lumenDividend, lumenFeeInvoiceDate, lumenFeeInvoiceNumber } from '../qonto/profiles/shared'
import { LUMEN_PAYROLL } from '../qonto/profiles/atelier-lumen'
import { VERDIER_STOCK, VERDIER_TNS_CONTRIBUTIONS } from '../qonto/profiles/maison-verdier'
import {
  TILLEULS_CONSTRUCTION,
  TILLEULS_LOAN,
  tilleulsInstalment,
  tilleulsLoanTable,
} from '../qonto/profiles/sci-les-tilleuls'
import { HOLDING_PARTICIPATION } from '../qonto/profiles/lumen-holding'
import { DIRECTOR_REIMBURSEMENT, REIMBURSED_REPORT, demoReportTotals, draftReport, submittedReport } from '../expense-reports'
import { DEMO_BUDGETS, planBudget2026 } from '../budgets'

const FROM = '2025-01-01'
const TO = '2026-10-31'
const RANGES = new Map(DEMO_PROFILES.map((p) => [p.engine.slug, p.engine.transactions(FROM, TO)]))
const range = (slug: string): DemoTransaction[] => RANGES.get(slug)!

const lumen = profileBySlug('atelier-lumen').engine
const verdier = profileBySlug('maison-verdier').engine
const tilleuls = profileBySlug('sci-les-tilleuls').engine
const holding = profileBySlug('lumen-holding').engine

/** Balance of an account over entries (debit minus credit). */
function accountBalance(entries: LedgerEntry[], test: (code: string) => boolean): number {
  return round2(entries.flatMap((e) => e.lines).filter((l) => test(l.account)).reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0))
}

describe.each(DEMO_PROFILES.map((p) => [p.engine.slug, p] as const))('bank activity of %s', (slug, profile) => {
  const engine = profile.engine
  const txs = range(slug)

  it('is deterministic for a given date', () => {
    const day = txs.find((t) => t.date >= '2026-09-01')!.date
    expect(engine.transactionsForDay(day)).toEqual(engine.transactionsForDay(day))
    expect(txs.length).toBeGreaterThan(0)
  })

  it('only generates on business days (no weekends, no French public holidays)', () => {
    expect(engine.transactionsForDay('2026-10-03')).toEqual([]) // Saturday
    expect(engine.transactionsForDay('2026-10-04')).toEqual([]) // Sunday
    expect(engine.transactionsForDay('2026-07-14')).toEqual([]) // Fête nationale
    expect(engine.transactionsForDay('2026-04-06')).toEqual([]) // Lundi de Pâques
    for (const tx of txs) {
      expect(isBusinessDay(tx.date)).toBe(true)
      expect(tx.settledAt.startsWith(tx.date)).toBe(true)
    }
  })

  it('keeps amounts, VAT and bookings consistent', () => {
    for (const tx of txs) {
      expect(tx.amount).toBeGreaterThan(0)
      expect(round2(tx.amount)).toBe(tx.amount)
      expect([20, 10, 5.5, 0, null]).toContain(tx.vatRate)
      expect(tx.vatAmount).toBe(vatFromGross(tx.amount, tx.vatRate))
      // The counterpart lines balance the bank line.
      expect(lineBalance(tx.booking)).toBe(tx.side === 'debit' ? tx.amount : -tx.amount)
      if (tx.vatAccount) {
        expect(tx.vatAccount).toMatch(/^445(71|66|62)$/)
        const vatLine = tx.booking.find((l) => l.account === tx.vatAccount)!
        // All of it, except fuel of a passenger car: 80 % (CGI art. 298-4-1°).
        const share = tx.kind === 'fuel' ? 0.8 : 1
        expect((vatLine.debit ?? 0) + (vatLine.credit ?? 0)).toBe(share === 1 ? tx.vatAmount : vatFromGross(tx.amount * share, tx.vatRate))
        expect(tx.vatAccount === '44571').toBe(tx.side === 'credit')
      } else {
        expect(tx.booking.some((l) => l.account.startsWith('4456') || l.account === '44571')).toBe(false)
      }
    }
  })

  it('uses unique transaction ids prefixed by the company', () => {
    expect(new Set(txs.map((t) => t.transactionId)).size).toBe(txs.length)
    for (const tx of txs) expect(tx.transactionId.startsWith(`${slug}-`)).toBe(true)
  })

  it('has its own valid IBAN on the fictitious bank code 99999', () => {
    expect(isValidIban(profile.bankAccount.iban)).toBe(true)
    expect(profile.bankAccount.iban.slice(4, 9)).toBe('99999')
  })

  it('books a balanced 2025 ledger whose result matches the summary', () => {
    const ledger = engine.ledger(2025)
    for (const entry of ledger) {
      expect(entry.lines.length).toBeGreaterThanOrEqual(2)
      expect(lineBalance(entry.lines)).toBe(0)
      for (const line of entry.lines) expect(Boolean(line.debit) !== Boolean(line.credit)).toBe(true)
    }
    const summary = engine.summary(2025)
    const result = -accountBalance(ledger, (c) => /^[67]/.test(c))
    expect(result).toBe(summary.netResult)
    expect(summary.corporateTax).toBe(computeCorporateTax(summary.taxableIncome))
  })

  it('has a 2025 balance sheet that balances (assets = equity and liabilities + result)', () => {
    const ledger = engine.ledger(2025)
    const balanceSheet = accountBalance(ledger, (c) => /^[1-5]/.test(c))
    const result = -accountBalance(ledger, (c) => /^[67]/.test(c))
    expect(round2(balanceSheet - result)).toBe(0)
  })

  it('books the 2026 ledger up to a cutoff only', () => {
    const ledger = engine.ledger(2026, '2026-08-31')
    expect(ledger.every((e) => e.date >= '2026-01-01' && e.date <= '2026-08-31')).toBe(true)
    expect(ledger.some((e) => e.journal === 'AN')).toBe(false)
  })

  it('never overdraws the bank account', () => {
    let balance = engine.spec.opening.bank
    for (const tx of txs) {
      balance = round2(balance + (tx.side === 'credit' ? tx.amount : -tx.amount))
      expect(balance).toBeGreaterThan(0)
    }
  })
})

describe('Atelier Lumen', () => {
  const txs = range('atelier-lumen')

  it('generates 1 to 3 transactions per business day', () => {
    let day = FROM
    while (day <= TO) {
      const count = lumen.transactionsForDay(day).length
      if (isBusinessDay(day)) {
        expect(count).toBeGreaterThanOrEqual(1)
        expect(count).toBeLessThanOrEqual(3)
      } else {
        expect(count).toBe(0)
      }
      day = addDays(day, 1)
    }
  })

  it('books client payments as VAT-collected revenue', () => {
    const payments = txs.filter((t) => t.kind === 'client_payment')
    expect(payments.length).toBeGreaterThan(40)
    for (const p of payments) {
      expect(p.side).toBe('credit')
      expect(p.account).toBe('706')
      expect(p.vatAccount).toBe('44571')
      expect(p.invoiceNumber).toBeTruthy()
    }
    expect(txs.some((t) => t.vatRate === 10)).toBe(true)
    expect(txs.some((t) => t.vatRate === 5.5)).toBe(true)
    for (const kind of ['rent', 'urssaf', 'vat_payment', 'corporate_tax', 'salary', 'management_fees', 'dividend']) {
      expect(txs.some((t) => t.kind === kind)).toBe(true)
    }
  })

  it('pays each month the VAT computed for the previous month', () => {
    const vatPayments = txs.filter((t) => t.kind === 'vat_payment' && t.date >= '2025-02-01' && t.date <= '2026-09-30')
    for (const payment of vatPayments) {
      const year = Number(payment.date.slice(0, 4))
      const month = Number(payment.date.slice(5, 7))
      const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
      expect(payment.amount).toBe(lumen.monthlyVat(prev.y, prev.m).due)
    }
    const v = lumen.monthlyVat(2025, 6)
    expect(round2(v.collected - v.deductibleServices - v.deductibleAssets - v.carryIn)).toBe(round2(v.due - v.carryOut))
  })

  it('pays the payroll contributions booked the month before', () => {
    const urssaf = txs.filter((t) => t.kind === 'urssaf')
    expect(urssaf.length).toBeGreaterThan(12)
    for (const p of urssaf) expect(p.amount).toBe(LUMEN_PAYROLL.urssaf)
    expect(LUMEN_PAYROLL.net).toBe(LUMEN_PAYROLL.gross - LUMEN_PAYROLL.employeeContributions)
  })

  it('makes a profit in 2025 with corporate tax at 15% then 25%', () => {
    const summary = lumen.summary(2025)
    expect(summary.resultBeforeTax).toBeGreaterThan(0)
    expect(summary.netResult).toBeGreaterThan(0)
    expect(computeCorporateTax(42500)).toBe(6375)
    expect(computeCorporateTax(52500)).toBe(8875)
    expect(computeCorporateTax(-10)).toBe(0)
  })
})

describe('Maison Verdier', () => {
  const txs = range('maison-verdier')

  it('sells food at 5.5% through card payouts and gift boxes at 20%', () => {
    const payouts = txs.filter((t) => t.kind === 'card_payout')
    expect(payouts.length).toBeGreaterThan(150)
    for (const p of payouts) {
      expect([2, 5]).toContain(new Date(`${p.date}T00:00:00Z`).getUTCDay())
      expect(p.vatRate).toBe(5.5)
      expect(p.account).toBe('707')
    }
    expect(txs.some((t) => t.kind === 'client_payment' && t.vatRate === 20 && t.account === '707')).toBe(true)
    expect(txs.some((t) => t.account === '607' && t.vatRate === 5.5)).toBe(true)
  })

  it('charges the TNS contributions of the manager to 646 and pays no salary', () => {
    const tns = txs.filter((t) => t.account === '646')
    expect(tns.length).toBeGreaterThanOrEqual(21)
    for (const t of tns) expect(t.amount).toBe(VERDIER_TNS_CONTRIBUTIONS)
    const ledger = verdier.ledger(2025)
    expect(ledger.flatMap((e) => e.lines).some((l) => /^64[1-5]/.test(l.account) || l.account === '421')).toBe(false)
    expect(accountBalance(ledger, (c) => c === '646')).toBe(12 * VERDIER_TNS_CONTRIBUTIONS)
  })

  it('books the stock variation at closing', () => {
    const ledger = verdier.ledger(2025)
    expect(accountBalance(ledger, (c) => c === '37')).toBe(VERDIER_STOCK[2025])
    expect(accountBalance(ledger, (c) => c === '6037')).toBe(VERDIER_STOCK[2024] - VERDIER_STOCK[2025])
  })
})

describe('SCI Les Tilleuls', () => {
  const txs = range('sci-les-tilleuls')

  it('collects VAT-exempt rents and books purchases VAT included', () => {
    const rents = txs.filter((t) => t.kind === 'rent')
    expect(rents.length).toBe(4 * 22)
    for (const r of rents) {
      expect(r.account).toBe('706')
      expect(r.vatRate).toBeNull()
    }
    for (const t of txs) expect(t.vatAccount).toBeNull()
    expect(tilleuls.spec.vatMonthly).toBe(false)
  })

  it('splits each loan instalment between capital (164) and interest (6611)', () => {
    const table = tilleulsLoanTable()
    expect(table).toHaveLength(TILLEULS_LOAN.months)
    expect(round2(table.reduce((s, i) => s + i.capital, 0))).toBe(TILLEULS_LOAN.principal)
    expect(table.at(-1)!.outstanding).toBe(0)
    const loans = txs.filter((t) => t.kind === 'loan')
    expect(loans.length).toBe(22)
    for (const loan of loans) {
      const instalment = tilleulsInstalment(Number(loan.date.slice(0, 4)), Number(loan.date.slice(5, 7)))!
      expect(loan.booking).toEqual([
        expect.objectContaining({ account: '164', debit: instalment.capital }),
        expect.objectContaining({ account: '6611', debit: instalment.interest }),
      ])
    }
  })

  it('depreciates the construction over 30 years but not the land', () => {
    const [depreciation] = tilleuls.depreciation(2025)
    expect(depreciation.asset.account).toBe('2131')
    expect(Math.abs(depreciation.amount - TILLEULS_CONSTRUCTION.amountHT / 30)).toBeLessThan(1)
    const ledger = tilleuls.ledger(2025)
    expect(accountBalance(ledger, (c) => c === '2111')).toBe(76000)
    expect(ledger.flatMap((e) => e.lines).filter((l) => l.account === '2811')).toEqual([])
  })

  it('pays its property tax, insurance and management fees', () => {
    for (const account of ['63512', '616', '6226']) expect(txs.some((t) => t.account === account)).toBe(true)
  })
})

describe('Lumen Holding and Atelier Lumen books agree', () => {
  const lumenTxs = range('atelier-lumen')
  const holdingTxs = range('lumen-holding')

  it('receives the management fees Atelier Lumen pays, same day and amount', () => {
    const paid = lumenTxs.filter((t) => t.kind === 'management_fees')
    const received = holdingTxs.filter((t) => t.kind === 'management_fees')
    expect(paid.length).toBeGreaterThan(12)
    expect(received.map((t) => [t.date, t.amount])).toEqual(paid.map((t) => [t.date, t.amount]))
    for (const t of paid) expect(t.amount).toBe(round2(LUMEN_MANAGEMENT_FEE.net * 1.2))
    // Each transfer settles the customer account (the invoice carries the revenue and the VAT, on debits).
    const aux = { number: LUMEN_MANAGEMENT_FEE.customerAux, label: LUMEN_MANAGEMENT_FEE.customerName }
    for (const t of received) {
      expect(t.booking).toEqual([{ account: '411', credit: t.amount, auxiliary: aux }])
      expect(t.vatAccount).toBeNull()
      const month = Number(t.date.slice(5, 7))
      expect(t.reference).toBe(lumenFeeInvoiceNumber(Number(t.date.slice(0, 4)), month))
      expect(paid.find((p) => p.date === t.date)?.reference).toBe(t.reference)
    }
  })

  it('invoices the management fees on the first day of each month (VE, 411 / 706 / 44571, VAT on debits)', () => {
    for (const year of [2025, 2026]) {
      const invoices = holding.ledger(year).filter((e) => e.journal === 'VE')
      expect(invoices.map((e) => e.reference)).toEqual(Array.from({ length: 12 }, (_, i) => lumenFeeInvoiceNumber(year, i + 1)))
      for (const [i, entry] of invoices.entries()) {
        expect(entry.date).toBe(lumenFeeInvoiceDate(year, i + 1))
        expect(entry.lines.map((l) => [l.account, l.debit ?? 0, l.credit ?? 0])).toEqual([
          ['411', 1800, 0],
          ['706', 0, LUMEN_MANAGEMENT_FEE.net],
          ['44571', 0, 300],
        ])
      }
      // Every invoice of the year is settled: the customer account is cleared.
      expect(accountBalance(holding.ledger(year), (c) => c === '411')).toBe(0)
      // The VAT of the invoices is collected in their month (CA3).
      expect(holding.monthlyVat(year, 3).collected).toBe(300)
    }
    expect(holding.summary(2025).revenue).toBe(12 * LUMEN_MANAGEMENT_FEE.net)
  })

  it('receives the dividends voted and paid by Atelier Lumen (457 / 512 on the subsidiary side)', () => {
    for (const year of [2025, 2026]) {
      const dividend = lumenDividend(year)
      const paid = lumenTxs.find((t) => t.kind === 'dividend' && t.date.startsWith(String(year)))!
      const received = holdingTxs.find((t) => t.kind === 'dividend' && t.date.startsWith(String(year)))!
      expect(paid).toMatchObject({ date: dividend.payment, amount: dividend.amount, account: '457', side: 'debit' })
      expect(received).toMatchObject({ date: dividend.payment, amount: dividend.amount, account: '761', side: 'credit' })
      const agm = lumen.ledger(year).find((e) => e.reference === `AGO-${year}`)!
      expect(agm.date).toBe(dividend.agm)
      expect(agm.lines).toContainEqual({ account: '457', credit: dividend.amount })
    }
    // 457 is cleared once paid.
    expect(accountBalance(lumen.ledger(2025), (c) => c === '457')).toBe(0)
  })

  it('taxes only 5% of the dividends (parent-subsidiary regime)', () => {
    const summary = holding.summary(2025)
    expect(summary.otherIncome).toBe(lumenDividend(2025).amount)
    expect(summary.taxableIncome).toBe(round2(summary.resultBeforeTax - 0.95 * lumenDividend(2025).amount))
    expect(accountBalance(holding.ledger(2025), (c) => c === '261')).toBe(HOLDING_PARTICIPATION)
  })
})

describe("Atelier Lumen's president and her expense reports", () => {
  it('reimburses NDF-0001 with one transfer of exactly what Kledg computes it owes (421)', () => {
    const totals = demoReportTotals(REIMBURSED_REPORT)
    const transfers = range('atelier-lumen').filter((t) => t.kind === 'expense_reimbursement')
    expect(transfers).toHaveLength(1)
    const [transfer] = transfers
    expect(transfer).toMatchObject({ date: DIRECTOR_REIMBURSEMENT.date, side: 'debit', account: '421', reference: 'NDF-0001', vatAccount: null })
    expect(Math.round(transfer.amount * 100)).toBe(totals.totalInclTaxCents)
    expect(transfer.booking).toEqual([{ account: '421', debit: transfer.amount }])
    // After the report's period, in the 2026 books.
    expect(DIRECTOR_REIMBURSEMENT.date > REIMBURSED_REPORT.periodEnd).toBe(true)
    expect(lumen.ledger(2026).some((e) => e.transactionId === transfer.transactionId)).toBe(true)
  })

  it('writes reports Kledg accepts: lines in their period, French rates, recoverable VAT by its rules', () => {
    for (const report of [REIMBURSED_REPORT, submittedReport('2026-09'), draftReport('2026-10')]) {
      for (const line of report.lines) {
        expect(line.date >= report.periodStart && line.date <= report.periodEnd).toBe(true)
        expect([0, 550, 1000, 2000]).toContain(line.vatRateBp ?? 0)
      }
      const totals = demoReportTotals(report)
      expect(totals.lines.every((l) => l.error === null)).toBe(true)
      expect(totals.totalInclTaxCents).toBeGreaterThan(0)
    }
    // Train and hotel: no VAT recovered (CGI ann. II art. 206, IV, 2); the business lunch: recovered.
    const reimbursed = demoReportTotals(REIMBURSED_REPORT)
    expect(reimbursed.lines.map((l) => l.recoverableVatCents > 0)).toEqual([false, false, true, false])
  })
})

describe('2026 budgets of the demo', () => {
  for (const [slug, specs] of Object.entries(DEMO_BUDGETS)) {
    it(`plans ${slug} on class 6 and 7 prefixes, from its 2025 actuals`, () => {
      const engine = profileBySlug(slug).engine
      const plan = planBudget2026(engine, specs)
      expect(new Set(plan.map((l) => l.prefix)).size).toBe(plan.length)
      for (const line of plan) {
        expect(line.prefix).toMatch(/^[67][0-9]*$/)
        expect(line.amounts.length + line.recurring.length).toBeGreaterThan(0)
        for (const amount of line.amounts) expect(amount.month).toMatch(/^2026-(0[1-9]|1[0-2])$/)
        for (const item of line.recurring) expect(item.startMonth.startsWith('2026-')).toBe(true)
        const spec = specs.find((s) => s.prefix === line.prefix)!
        if (spec.fromActuals) {
          // Within the rounding of each month of the 2025 actuals times the growth.
          const others = specs.filter((s) => s.prefix !== spec.prefix && s.prefix.startsWith(spec.prefix))
          const actual = engine
            .ledger(2025)
            .flatMap((e) => e.lines)
            .filter((l) => l.account.startsWith(spec.prefix) && !others.some((o) => l.account.startsWith(o.prefix)))
            .reduce((sum, l) => sum + (spec.prefix.startsWith('7') ? -1 : 1) * ((l.debit ?? 0) - (l.credit ?? 0)), 0)
          const planned = line.amounts.reduce((sum, a) => sum + a.cents, 0) / 100
          expect(Math.abs(planned - actual * spec.fromActuals.growth)).toBeLessThanOrEqual(6 * spec.fromActuals.step + 0.01)
        }
      }
    })
  }

  it("budgets Atelier Lumen's management fees at the convention's monthly price", () => {
    const fees = planBudget2026(lumen, DEMO_BUDGETS['atelier-lumen']).find((l) => l.prefix === '6226')!
    expect(fees.recurring).toEqual([expect.objectContaining({ cents: LUMEN_MANAGEMENT_FEE.net * 100, frequency: 'MONTHLY', startMonth: '2026-01' })])
  })
})
