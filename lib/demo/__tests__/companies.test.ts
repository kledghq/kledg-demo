import { describe, expect, it } from 'vitest'
import type { TransactionRule, TransactionRuleCondition } from '@prisma/client'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { findMatchingRules, type RuleWithConditions } from '@/lib/transactions/rule-matcher'
import type { EnrichedTransaction } from '@/lib/transactions/types'
import { DEMO_COMPANIES, type DemoCompany } from '../companies'
import { createId } from '@/lib/crypto/ids'
import { profileBySlug } from '../qonto/profiles'
import { isLuhnValid } from '../qonto/profiles/shared'
import { DEMO_BANK_LEDGER, recoveredVatOf, type DemoTransaction } from '../qonto/engine'
import { simulateRuleFromData } from '@/lib/transactions/rule-simulator'

const PCG_CODES = new Set(PCG_ACCOUNTS.map((a) => a.code))

/** Rules as the matcher reads them from the database. */
function ruleRows(company: DemoCompany): RuleWithConditions[] {
  return company.rules.map((rule, index) => ({
    id: `${company.profile}-${index}`,
    companyId: company.profile,
    name: rule.name,
    description: rule.description,
    enabled: true,
    priority: rule.priority,
    journalCode: 'BQ',
    defaultVatAccountCode: null,
    autoCreate: rule.autoCreate,
    requireApproval: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    conditions: rule.conditions.map((c, i) => ({
      id: `${index}-${i}`,
      ruleId: `${company.profile}-${index}`,
      conditionType: c.conditionType,
      operator: c.operator,
      value: c.value,
      value2: null,
    })) as TransactionRuleCondition[],
  })) as Array<TransactionRule & { conditions: TransactionRuleCondition[] }>
}

/** A synced bank transaction, as the processing service enriches it. */
function enriched(tx: DemoTransaction): EnrichedTransaction {
  return {
    label: tx.label,
    reference: tx.reference,
    side: tx.side,
    amount: tx.amount,
    status: 'completed',
    counterpartyName: tx.counterparty,
    category: tx.category,
    cashflowCategory: null,
    cashflowSubcategory: null,
    operationType: tx.operationType,
  } as unknown as EnrichedTransaction
}

describe('demo companies', () => {
  it('have unique SIREN and SIRET numbers passing the Luhn check', () => {
    expect(new Set(DEMO_COMPANIES.map((c) => c.siren)).size).toBe(DEMO_COMPANIES.length)
    for (const company of DEMO_COMPANIES) {
      expect(company.siren).toMatch(/^\d{9}$/)
      expect(isLuhnValid(company.siren)).toBe(true)
      expect(company.siret.startsWith(company.siren)).toBe(true)
      expect(isLuhnValid(company.siret)).toBe(true)
    }
  })

  it('each have their own bank profile', () => {
    const profiles = DEMO_COMPANIES.map((c) => profileBySlug(c.profile))
    expect(new Set(profiles.map((p) => p.bankAccount.iban)).size).toBe(DEMO_COMPANIES.length)
    expect(new Set(profiles.map((p) => p.login)).size).toBe(DEMO_COMPANIES.length)
  })

  it('generate cuid-shaped unique ids', () => {
    const ids = Array.from({ length: 5000 }, createId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids.slice(0, 50)) expect(id).toMatch(/^c[0-9a-z]{24}$/)
  })
})

describe.each(DEMO_COMPANIES.map((c) => [c.name, c] as const))('transaction rules of %s', (_name, company) => {
  const rules = ruleRows(company)
  // Recent activity a visitor finds unreconciled (after the ledger cutoff).
  const recent = profileBySlug(company.profile).engine.transactions('2026-06-01', '2026-10-02')

  it('has 4 to 10 rules with enough conditions to be auto-applied (confidence >= 0.8)', () => {
    expect(company.rules.length).toBeGreaterThanOrEqual(4)
    expect(company.rules.length).toBeLessThanOrEqual(10)
    for (const rule of company.rules) expect(rule.conditions.length).toBeGreaterThanOrEqual(3)
  })

  it('sets autoCreate and a priority on every rule: variable spending is only suggested', () => {
    for (const rule of company.rules) {
      expect(typeof rule.autoCreate).toBe('boolean')
      expect(rule.priority).toBeGreaterThan(0)
    }
    const suggested = company.rules.filter((r) => !r.autoCreate).map((r) => r.name)
    for (const name of suggested) expect(name).toMatch(/Carburant|Fournitures|Déplacements/)
  })

  it('only uses PCG accounts and books the bank on 5121 (comptes en euros)', () => {
    for (const rule of company.rules) {
      for (const line of rule.entryLines) {
        expect(PCG_CODES.has(line.accountCode)).toBe(true)
        if (line.vatAccountCode) expect(PCG_CODES.has(line.vatAccountCode)).toBe(true)
      }
      expect(rule.entryLines.filter((l) => l.accountCode === DEMO_BANK_LEDGER)).toHaveLength(1)
    }
  })

  it('matches every rule on recent transactions, books them like the seed, and leaves some for manual work', () => {
    const matchesByRule = new Map<string, number>()
    let unmatched = 0
    for (const tx of recent) {
      const matches = findMatchingRules(rules, enriched(tx))
      if (matches.length === 0) {
        unmatched += 1
        continue
      }
      // Rules don't overlap.
      expect(matches).toHaveLength(1)
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0.8)
      matchesByRule.set(matches[0].ruleName, (matchesByRule.get(matches[0].ruleName) ?? 0) + 1)
      // The rule books the same accounts as the seed's ledger.
      const rule = company.rules.find((r) => r.name === matches[0].ruleName)!
      const counterpart = rule.entryLines.find((l) => l.accountCode !== DEMO_BANK_LEDGER)!
      expect(tx.booking.map((l) => l.account)).toContain(counterpart.accountCode)
      expect(counterpart.vatType !== 'none').toBe(tx.vatAccount !== null)
    }
    for (const rule of company.rules) {
      if (rule.name === 'Taxe foncière') continue // October only
      expect(matchesByRule.get(rule.name) ?? 0, rule.name).toBeGreaterThan(0)
    }
    expect(unmatched).toBeGreaterThan(0)
  })
})

describe('fuel and travel of Atelier Lumen', () => {
  const company = DEMO_COMPANIES.find((c) => c.profile === 'atelier-lumen')!
  const recent = profileBySlug(company.profile).engine.transactions('2026-01-01', '2026-10-02')

  // CGI art. 298-4-1° (BOFiP BOI-TVA-DED-30-30-20): 80 % of the VAT on diesel
  // and petrol of a passenger car is deductible; the rest is a cost.
  it('books 80 % of the VAT on fuel, like the rule a visitor applies', async () => {
    const fuel = recent.filter((tx) => tx.kind === 'fuel')
    expect(fuel.length).toBeGreaterThan(0)
    const rule = company.rules.find((r) => r.name === 'Carburant du véhicule')!
    expect(rule.autoCreate).toBe(false)
    for (const tx of fuel) {
      const vat = tx.booking.find((l) => l.account === '44566')!.debit!
      expect(vat).toBe(recoveredVatOf({ amount: tx.amount, vatRate: 20, vatDeductibleShare: 0.8 }))
      expect(vat).toBeCloseTo(tx.vatAmount * 0.8, 1)
      const simulated = await simulateRuleFromData(
        { entryLines: rule.entryLines.map((line, order) => ({ ...line, order })) },
        { amount: tx.amount, side: 'debit', label: tx.label },
      )
      const lines = simulated.entryLines
      const total = (code: string, side: 'debit' | 'credit') =>
        Math.round(lines.filter((l) => l.account.code === code).reduce((sum, l) => sum + l[side], 0) * 100)
      expect(total('44566', 'debit')).toBe(Math.round(vat * 100))
      expect(total('6061', 'debit') + total('44566', 'debit')).toBe(Math.round(tx.amount * 100))
      expect(total(DEMO_BANK_LEDGER, 'credit')).toBe(Math.round(tx.amount * 100))
    }
  })

  // CGI annexe II art. 206, IV-2-3°: VAT on passenger transport is not deductible.
  it('keeps the VAT of train tickets and rides in the expense', () => {
    const travel = recent.filter((tx) => tx.kind === 'travel')
    expect(travel.length).toBeGreaterThan(0)
    for (const tx of travel) {
      expect(tx.vatAmount).toBeGreaterThan(0)
      expect(tx.vatAccount).toBeNull()
      expect(tx.booking).toEqual([{ account: '6251', debit: tx.amount }])
    }
  })
})
