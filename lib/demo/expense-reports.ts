/**
 * Expense reports (notes de frais, lib/expense-reports) of Atelier Lumen's
 * president, Claire Vasseur, seeded in every sandbox (lib/demo/seed-features.ts).
 * Pure: the bank profile of Atelier Lumen reads the amount of the
 * reimbursement from here, so the transfer the simulated bank shows is
 * exactly what the posted report owes.
 *
 * She is the salaried president of the SASU (assimilée salariée, paid on
 * 421) and not an associate (Lumen Holding owns the shares): her claimant
 * file is a dirigeant credited on 421 (docs/notes-de-frais.md: "un dirigeant
 * assimilé salarié se règle sur 421"), auxiliary account D00001.
 *
 * Three reports, numbered in this order:
 * - NDF-0001, March 2026 (a client meeting in Paris and a trip to the
 *   printer), validated, posted and reimbursed by the transfer of
 *   DIRECTOR_REIMBURSEMENT.date (lettered with it);
 * - NDF-0002, the last elapsed month (a trade fair in Lyon), submitted:
 *   waiting for validation;
 * - NDF-0003, the current month (supplies and postage), a draft.
 */

import { computeReport, type LineInput } from '@/lib/expense-reports/amounts'
import type { ExpenseCategory } from '@/lib/expense-reports/categories'

export const DIRECTOR_CLAIMANT = {
  kind: 'DIRIGEANT' as const,
  name: 'Claire Vasseur',
  accountCode: '421',
  auxiliaryAccountNumber: 'D00001',
}

/** One line of a seeded report, in the shape of the expense report API (CreateExpenseReportBodySchema). */
export interface DemoExpenseLine {
  kind: 'EXPENSE' | 'MILEAGE'
  date: string
  supplierName?: string
  label: string
  category?: Exclude<ExpenseCategory, 'MILEAGE'>
  accountCode?: string
  amountInclTaxCents?: number
  vatRateBp?: number
  receiptKind: 'NONE' | 'RECEIPT' | 'INVOICE'
  receiptReference?: string
  vehicleType?: 'CAR'
  fiscalPower?: number
  distanceKm?: number
}

export interface DemoExpenseReport {
  label: string
  periodStart: string
  periodEnd: string
  lines: DemoExpenseLine[]
}

/** Her car for professional trips: a 5 CV petrol car (mileage scale, CGI art. 83 and BOI-BAREME-000001). */
const CAR = { vehicleType: 'CAR' as const, fiscalPower: 5 }

/** NDF-0001: posted and reimbursed. */
export const REIMBURSED_REPORT: DemoExpenseReport = {
  label: 'Rendez-vous Brasserie du Canal à Paris et BAT chez l’imprimeur',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  lines: [
    {
      kind: 'EXPENSE',
      date: '2026-03-10',
      supplierName: 'Transporteur ferroviaire',
      label: 'Train Lyon - Paris aller-retour',
      category: 'TRANSPORT',
      amountInclTaxCents: 14800,
      vatRateBp: 1000,
      receiptKind: 'INVOICE',
      receiptReference: 'Billet électronique, courriel du 2 mars 2026',
    },
    {
      kind: 'EXPENSE',
      date: '2026-03-10',
      supplierName: 'Hôtel des Canaux',
      label: 'Nuit d’hôtel, rendez-vous client du lendemain',
      category: 'LODGING',
      amountInclTaxCents: 13200,
      vatRateBp: 1000,
      receiptKind: 'INVOICE',
      receiptReference: 'Facture hôtel 2026-0311',
    },
    {
      kind: 'EXPENSE',
      date: '2026-03-11',
      supplierName: 'Bistrot Saint-Martin',
      label: 'Déjeuner de travail avec Brasserie du Canal',
      category: 'RECEPTION',
      amountInclTaxCents: 8640,
      vatRateBp: 1000,
      receiptKind: 'RECEIPT',
      receiptReference: 'Ticket détaillé au nom de la société',
    },
    {
      kind: 'MILEAGE',
      date: '2026-03-24',
      label: 'Lyon - Villefranche-sur-Saône aller-retour, BAT chez l’imprimeur',
      receiptKind: 'NONE',
      distanceKm: 68,
      ...CAR,
    },
  ],
}

/** The reimbursement of NDF-0001: a transfer from Atelier Lumen's account to its president. */
export const DIRECTOR_REIMBURSEMENT = {
  date: '2026-04-08',
  number: 'NDF-0001',
}

/** The report of the month `month` (yyyy-mm), submitted: a trade fair. Lines on its first days, all elapsed. */
export function submittedReport(month: string): DemoExpenseReport {
  return {
    label: 'Salon Graphisme et Édition, Lyon',
    periodStart: `${month}-01`,
    periodEnd: lastDayOf(month),
    lines: [
      {
        kind: 'EXPENSE',
        date: `${month}-03`,
        supplierName: 'Salon Graphisme et Édition',
        label: 'Entrée professionnelle au salon',
        category: 'OTHER',
        accountCode: '6233',
        amountInclTaxCents: 4500,
        vatRateBp: 2000,
        receiptKind: 'INVOICE',
        receiptReference: 'Facture en ligne du salon',
      },
      {
        kind: 'EXPENSE',
        date: `${month}-03`,
        supplierName: 'Cantine du Marché',
        label: 'Déjeuner sur le salon',
        category: 'MEALS',
        amountInclTaxCents: 2450,
        vatRateBp: 1000,
        receiptKind: 'RECEIPT',
        receiptReference: 'Ticket détaillé',
      },
      {
        kind: 'MILEAGE',
        date: `${month}-03`,
        label: 'Lyon - Parc des expositions aller-retour',
        receiptKind: 'NONE',
        distanceKm: 26,
        ...CAR,
      },
    ],
  }
}

/** The report of the current month `month` (yyyy-mm), a draft dated on its first day (never in the future). */
export function draftReport(month: string): DemoExpenseReport {
  return {
    label: 'Fournitures et envois de maquettes',
    periodStart: `${month}-01`,
    periodEnd: lastDayOf(month),
    lines: [
      {
        kind: 'EXPENSE',
        date: `${month}-01`,
        supplierName: 'Papeterie du Centre',
        label: 'Carnets de croquis et feutres',
        category: 'SUPPLIES',
        amountInclTaxCents: 1890,
        vatRateBp: 2000,
        receiptKind: 'RECEIPT',
      },
      {
        kind: 'EXPENSE',
        date: `${month}-01`,
        supplierName: 'Bureau de poste',
        label: 'Envoi recommandé des maquettes imprimées',
        category: 'POSTAGE',
        amountInclTaxCents: 785,
        vatRateBp: 0,
        receiptKind: 'RECEIPT',
      },
    ],
  }
}

function lastDayOf(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Amounts of a report as Kledg computes them (lib/expense-reports/amounts.ts), mileage counted from 0 km in the year. */
export function demoReportTotals(report: DemoExpenseReport) {
  const lines: LineInput[] = report.lines.map((line) => ({
    kind: line.kind,
    date: line.date,
    category: line.kind === 'MILEAGE' ? 'MILEAGE' : (line.category ?? 'OTHER'),
    amountInclTaxCents: line.amountInclTaxCents ?? 0,
    vatRateBp: line.vatRateBp ?? 0,
    vatCents: null,
    receiptKind: line.receiptKind,
    vehicleType: line.vehicleType ?? null,
    fiscalPower: line.fiscalPower ?? null,
    electric: false,
    distanceKm: line.distanceKm ?? null,
    priorDistanceKm: 0,
  }))
  return computeReport(lines, { vatExempt: false })
}

/** What NDF-0001 owes its claimant, in euros: the amount of the reimbursement transfer. */
export function reimbursedReportTotal(): number {
  return demoReportTotals(REIMBURSED_REPORT).totalInclTaxCents / 100
}
