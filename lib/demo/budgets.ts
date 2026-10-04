/**
 * The 2026 budgets of the demo (lib/budgets, seeded by lib/demo/seed-features.ts),
 * planned from the 2025 books the engine generates. Pure: no database.
 */

import type { DemoProfileEngine } from './qonto/engine'
import { LUMEN_MANAGEMENT_FEE } from './qonto/profiles/shared'

export interface BudgetLineSpec {
  prefix: string
  label: string
  /**
   * Monthly amounts: the 2025 actuals of the prefix's accounts, month by
   * month, times `growth`, rounded to `step` euros. Absent: recurring items only.
   */
  fromActuals?: { growth: number; step: number }
  recurring?: Array<{ label: string; amount: number; frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'; startMonth: string }>
}

/**
 * Budget lines of the 2026 budgets. Atelier Lumen plans more sales and its
 * known commitments (rent, management fees, payroll, software, insurance,
 * CFE) as recurring items; Maison Verdier plans its sales and purchases from
 * 2025. Accounts left out (books, depreciation, corporate tax) show as
 * "hors budget" in the comparison.
 */
export const DEMO_BUDGETS: Readonly<Record<string, readonly BudgetLineSpec[]>> = {
  'atelier-lumen': [
    { prefix: '706', label: 'Prestations de design', fromActuals: { growth: 1.08, step: 50 } },
    { prefix: '604', label: 'Sous-traitance et impressions', fromActuals: { growth: 1, step: 10 } },
    { prefix: '606', label: 'Carburant, fournitures et petit matériel', fromActuals: { growth: 1, step: 10 } },
    { prefix: '6132', label: 'Loyer de l’atelier', recurring: [{ label: 'Loyer SCI Quai des Lumières', amount: 1250, frequency: 'MONTHLY', startMonth: '2026-01' }] },
    { prefix: '616', label: 'Assurance RC Pro', recurring: [{ label: 'Prime mensuelle RC Pro', amount: 54.2, frequency: 'MONTHLY', startMonth: '2026-01' }] },
    {
      prefix: '6226',
      label: 'Frais de gestion Lumen Holding',
      recurring: [{ label: `${LUMEN_MANAGEMENT_FEE.convention}, forfait mensuel`, amount: LUMEN_MANAGEMENT_FEE.net, frequency: 'MONTHLY', startMonth: '2026-01' }],
    },
    { prefix: '625', label: 'Déplacements, missions et réceptions', fromActuals: { growth: 1, step: 10 } },
    { prefix: '626', label: 'Télécommunications, hébergement web et envois', fromActuals: { growth: 1, step: 10 } },
    { prefix: '627', label: 'Frais bancaires', recurring: [{ label: 'Abonnement compte professionnel', amount: 29, frequency: 'MONTHLY', startMonth: '2026-01' }] },
    {
      prefix: '651',
      label: 'Logiciels et licences',
      recurring: [
        { label: 'Logiciel de facturation', amount: 29, frequency: 'MONTHLY', startMonth: '2026-01' },
        { label: 'Suite de création graphique', amount: 71.99, frequency: 'MONTHLY', startMonth: '2026-01' },
      ],
    },
    { prefix: '635', label: 'Impôts et taxes', recurring: [{ label: 'CFE', amount: 486, frequency: 'YEARLY', startMonth: '2026-12' }] },
    { prefix: '64', label: 'Rémunération de la présidente', recurring: [{ label: 'Salaire brut et charges patronales', amount: 5720, frequency: 'MONTHLY', startMonth: '2026-01' }] },
  ],
  'maison-verdier': [
    { prefix: '707', label: 'Ventes de l’épicerie en ligne', fromActuals: { growth: 1.05, step: 50 } },
    { prefix: '607', label: 'Achats de marchandises', fromActuals: { growth: 1.05, step: 50 } },
    { prefix: '6026', label: 'Emballages', fromActuals: { growth: 1.05, step: 10 } },
    { prefix: '6132', label: 'Loyer de l’entrepôt', recurring: [{ label: 'Loyer mensuel', amount: 950, frequency: 'MONTHLY', startMonth: '2026-01' }] },
    { prefix: '6231', label: 'Publicité en ligne', fromActuals: { growth: 1.1, step: 10 } },
    { prefix: '6242', label: 'Transports sur ventes', fromActuals: { growth: 1.05, step: 10 } },
    { prefix: '646', label: 'Cotisations sociales du gérant', recurring: [{ label: 'Acompte mensuel de cotisations', amount: 380, frequency: 'MONTHLY', startMonth: '2026-01' }] },
  ],
}

export interface PlannedBudgetLine {
  prefix: string
  label: string
  amounts: Array<{ month: string; cents: number }>
  recurring: Array<{ label: string; cents: number; frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'; startMonth: string }>
}

/**
 * The 2026 budget of a profile: 2025 actuals per line and month (an account
 * goes to the line with the longest matching prefix, like the budget
 * report), times the growth, rounded to the step; zero months left out.
 */
export function planBudget2026(engine: DemoProfileEngine, specs: readonly BudgetLineSpec[]): PlannedBudgetLine[] {
  const actuals = new Map<string, number[]>(specs.map((s) => [s.prefix, new Array<number>(12).fill(0)]))
  for (const entry of engine.ledger(2025)) {
    const month = Number(entry.date.slice(5, 7)) - 1
    for (const line of entry.lines) {
      const spec = specs.filter((s) => line.account.startsWith(s.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
      if (!spec) continue
      const signed = (line.debit ?? 0) - (line.credit ?? 0)
      actuals.get(spec.prefix)![month] += spec.prefix.startsWith('7') ? -signed : signed
    }
  }
  return specs.map((spec) => {
    const amounts = spec.fromActuals
      ? actuals
          .get(spec.prefix)!
          .map((actual, index) => ({
            month: `2026-${String(index + 1).padStart(2, '0')}`,
            cents: Math.round((actual * spec.fromActuals!.growth) / spec.fromActuals!.step) * spec.fromActuals!.step * 100,
          }))
          .filter((a) => a.cents !== 0)
      : []
    const recurring = (spec.recurring ?? []).map((item) => ({ ...item, cents: Math.round(item.amount * 100) }))
    return { prefix: spec.prefix, label: spec.label, amounts, recurring }
  })
}
