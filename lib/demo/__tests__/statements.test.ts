/**
 * The demo companies produce consistent statements with Kledg's default
 * mappings: balanced 2025 and 2026 balance sheets, the same result on both
 * statements, and a closing and opening of 2025 that carry every balance.
 * Moved from Kledg's default-mapping tests when the demo became a fork.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_PROFILES } from '@/lib/demo/qonto/profiles'
import type { LedgerEntry } from '@/lib/demo/qonto/engine'
import {
  applyLines,
  computeClosingEntry,
  computeOpeningEntry,
} from '@/lib/accounting/fiscal-year-closure/closing-entries'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { buildBalanceSheet } from '@/lib/reports/statements/balance-sheet'
import { buildIncomeStatement } from '@/lib/reports/statements/income-statement'
import { defaultBalanceSheetRules, defaultIncomeStatementRules } from '@/lib/reports/statements/default-rules'

const VARIANTS = ['complete', 'simplified'] as const

const account = (code: string, debitCents: number, creditCents = 0): AccountTotals => ({
  accountId: `id-${code}`,
  code,
  label: code,
  debitCents,
  creditCents,
})

function totalsOf(entries: LedgerEntry[]): AccountTotals[] {
  const totals = new Map<string, AccountTotals>()
  for (const line of entries.flatMap((e) => e.lines)) {
    const t = totals.get(line.account) ?? account(line.account, 0)
    t.debitCents += Math.round((line.debit ?? 0) * 100)
    t.creditCents += Math.round((line.credit ?? 0) * 100)
    totals.set(line.account, t)
  }
  return [...totals.values()]
}

describe.each(DEMO_PROFILES.map((p) => [p.engine.slug, p.engine] as const))('demo company %s', (_slug, engine) => {
  const accounts2025 = totalsOf(engine.ledger(2025))
  const closing = computeClosingEntry(accounts2025)
  const after = applyLines(accounts2025, closing.lines)
  const opening = computeOpeningEntry(after)
  const accounts2026 = applyLines(
    opening.map((l) => account(l.code, l.debitCents, l.creditCents)),
    totalsOf(engine.ledger(2026, '2026-08-31')).flatMap((t) => [
      { code: t.code, debitCents: t.debitCents, creditCents: t.creditCents },
    ])
  )

  it.each(VARIANTS)('2025 (%s): balanced, real result on both statements', (variant) => {
    const input = { companyId: 'c', fiscalYearId: 'fy', reportVariant: variant, accounts: accounts2025 }
    const sheet = buildBalanceSheet({ ...input, rules: defaultBalanceSheetRules(variant) })
    const statement = buildIncomeStatement({ ...input, rules: defaultIncomeStatementRules(variant) })
    expect(sheet.imbalance).toBeUndefined()
    expect(sheet.warnings).toEqual([])
    expect(statement.warnings).toEqual([])
    expect(statement.netResult).toBe(engine.summary(2025).netResult)
    expect(sheet.netResult).toBe(statement.netResult)
  })

  it('closes 2025 into 120 / 129 and opens 2026 with the closing balances', () => {
    expect(closing.resultCents).toBe(Math.round(engine.summary(2025).netResult * 100))
    const result = after.find((a) => a.code === (closing.resultCents >= 0 ? '120' : '129'))!
    expect(result.creditCents - result.debitCents).toBe(closing.resultCents)
    // Every balance sheet account opens 2026 with its 2025 closing balance.
    for (const a of after.filter((x) => /^[1-5]/.test(x.code))) {
      const line = opening.find((l) => l.code === a.code)
      expect((line?.debitCents ?? 0) - (line?.creditCents ?? 0), a.code).toBe(a.debitCents - a.creditCents)
    }
    expect(opening.some((l) => /^[67]/.test(l.code))).toBe(false)
  })

  it.each(VARIANTS)('2026 to date (%s): balanced and consistent', (variant) => {
    const input = { companyId: 'c', fiscalYearId: 'fy', reportVariant: variant, accounts: accounts2026 }
    const sheet = buildBalanceSheet({ ...input, rules: defaultBalanceSheetRules(variant) })
    const statement = buildIncomeStatement({ ...input, rules: defaultIncomeStatementRules(variant) })
    expect(sheet.imbalance).toBeUndefined()
    expect(sheet.warnings).toEqual([])
    expect(sheet.netResult).toBe(statement.netResult)
  })

  it('books the 2026 allocation of the 2025 result consistently', () => {
    // Accounts 12 only keep a 2025 result that is not allocated yet.
    const twelve = accounts2026.filter((a) => a.code.startsWith('12'))
    const left = twelve.reduce((s, a) => s + a.creditCents - a.debitCents, 0)
    expect(left === 0 || left === closing.resultCents).toBe(true)
  })
})
