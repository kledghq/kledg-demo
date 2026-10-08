/**
 * The four fictional companies of the public demo, with what the seed stores
 * about them (identity, tax regimes) and the transaction rules (règles
 * d'affectation) a visitor can run on the unreconciled bank transactions.
 *
 * Names, SIREN numbers, addresses and IBANs are fictitious. SIREN and SIRET
 * numbers pass the Luhn check; IBANs use the fictitious bank code 99999.
 */

import type { CompanyLegalType } from '@prisma/client'
import { DEMO_BANK_LEDGER } from './qonto/engine'
import { HOLDING_FOUNDER } from './qonto/profiles/lumen-holding'
import { FUEL_VAT_DEDUCTIBLE_SHARE } from './qonto/profiles/atelier-lumen'

export interface DemoRuleCondition {
  conditionType: 'label' | 'counterparty' | 'side' | 'operationType' | 'amount'
  operator: 'equals' | 'contains' | 'startsWith' | 'regex'
  value: string
}

/** Same shape as the rule entry lines the rules UI creates (TransactionRuleEntryLineInput). */
export interface DemoRuleEntryLine {
  accountCode: string
  lineType: 'debit' | 'credit'
  amountType: 'full' | 'percentage'
  /** Percentage of the transaction for amountType 'percentage'. */
  amountValue?: number
  vatType: 'none' | 'deductible' | 'collectible'
  vatRateSource: 'fixed' | 'transaction'
  vatRate: number | null
  vatAccountCode: string | null
  description: string | null
}

export interface DemoRule {
  name: string
  description: string
  /**
   * Applied by "Actualiser et rapprocher" without a click (recurring,
   * unambiguous payments: rent, subscriptions, bank fees, insurance, payroll
   * and social charges, taxes, a regular client), or only suggested, for the
   * visitor to apply in one click (variable spending: fuel, supplies,
   * travel). lib/transactions/rule-matcher.ts.
   */
  autoCreate: boolean
  /** Higher first when several rules match (lib/transactions/rule-matcher.ts pickRule). */
  priority: number
  conditions: DemoRuleCondition[]
  entryLines: DemoRuleEntryLine[]
}

/**
 * The company's manager, played by a fictional account in the accountant
 * persona of the demo (lib/demo/sandbox/persona.ts): companyAdmin of the
 * company, never able to sign in.
 */
export interface DemoDirector {
  name: string
  /** Local part of the account's email, before the sandbox key. */
  login: string
}

export interface DemoCompany {
  /** Bank profile slug (lib/demo/qonto/profiles). */
  profile: string
  name: string
  director: DemoDirector
  siren: string
  siret: string
  email: string
  phone: string
  activityCode: string
  foundationDate: string
  legalType: CompanyLegalType | null
  legalForm: string
  sector: string
  isHolding: boolean
  vatRegime: 'normal' | null
  isVatExempt: boolean
  vatExemptReason: string | null
  /**
   * Option to pay the VAT on services on debits (CGI art. 269, 2, c):
   * Company.servicesVatOnDebits. Lumen Holding opted for it, so the VAT of
   * its management fee invoices is due on the invoice.
   */
  servicesVatOnDebits?: boolean
  corporateTaxRegime: 'simplified' | 'normal'
  taxOffice: string
  totalShares: number
  shareNominalValue: number
  color: string
  address: { street: string; postalCode: string; city: string }
  rules: DemoRule[]
}

const CLAIRE_VASSEUR: DemoDirector = { name: HOLDING_FOUNDER, login: 'claire.vasseur' }

const condition = (
  conditionType: DemoRuleCondition['conditionType'],
  operator: DemoRuleCondition['operator'],
  value: string
): DemoRuleCondition => ({ conditionType, operator, value })

const debitBank = { accountCode: DEMO_BANK_LEDGER, lineType: 'debit', amountType: 'full', vatType: 'none', vatRateSource: 'fixed', vatRate: null, vatAccountCode: null, description: null } as const
const creditBank = { ...debitBank, lineType: 'credit' } as const

/** Outgoing payment: bank credited, charge (or third-party account) debited, VAT from the receipt. */
function payment(account: string, withVat: boolean): DemoRuleEntryLine[] {
  return [
    { ...creditBank },
    {
      accountCode: account,
      lineType: 'debit',
      amountType: 'full',
      vatType: withVat ? 'deductible' : 'none',
      vatRateSource: withVat ? 'transaction' : 'fixed',
      vatRate: withVat ? 20 : null,
      vatAccountCode: withVat ? '44566' : null,
      description: null,
    },
  ]
}

/** Incoming payment: bank debited, revenue (or third-party account) credited, VAT collected from the transaction. */
function receipt(account: string, withVat: boolean): DemoRuleEntryLine[] {
  return [
    { ...debitBank },
    {
      accountCode: account,
      lineType: 'credit',
      amountType: 'full',
      vatType: withVat ? 'collectible' : 'none',
      vatRateSource: withVat ? 'transaction' : 'fixed',
      vatRate: withVat ? 20 : null,
      vatAccountCode: withVat ? '44571' : null,
      description: null,
    },
  ]
}

const debit = condition('side', 'equals', 'debit')
const credit = condition('side', 'equals', 'credit')

/**
 * Fuel of a passenger car: 80 % of the VAT is deductible (CGI art.
 * 298-4-1°, diesel and petrol since 2022; BOFiP BOI-TVA-DED-30-30-20), the
 * rest is a cost. Kledg's rules split a transaction by percentages: 80 % of
 * the amount with its VAT at 20 % (the deductible part), 20 % without VAT.
 * Same booking as the seed (lib/demo/qonto/engine.ts, vatDeductibleShare).
 */
function fuelPayment(account: string): DemoRuleEntryLine[] {
  const share = Math.round(FUEL_VAT_DEDUCTIBLE_SHARE * 100)
  return [
    { ...creditBank },
    {
      accountCode: account,
      lineType: 'debit',
      amountType: 'percentage',
      amountValue: share,
      vatType: 'deductible',
      vatRateSource: 'fixed',
      vatRate: 20,
      vatAccountCode: '44566',
      description: null,
    },
    {
      accountCode: account,
      lineType: 'debit',
      amountType: 'percentage',
      amountValue: 100 - share,
      vatType: 'none',
      vatRateSource: 'fixed',
      vatRate: null,
      vatAccountCode: null,
      description: 'TVA non déductible (80 % seulement sur le carburant)',
    },
  ]
}

const BANK_FEES_RULE: DemoRule = {
  name: 'Frais bancaires',
  description: 'Abonnement mensuel du compte professionnel',
  autoCreate: true,
  priority: 50,
  conditions: [condition('operationType', 'equals', 'qonto_fee'), debit, condition('counterparty', 'contains', 'Abonnement compte')],
  entryLines: payment('627', true),
}

const VAT_PAYMENT_RULE: DemoRule = {
  name: 'TVA à décaisser (CA3)',
  description: 'Prélèvement DGFiP de la TVA du mois précédent',
  autoCreate: true,
  // Before any other DGFiP payment (corporate tax, property tax).
  priority: 90,
  conditions: [condition('counterparty', 'equals', 'DGFiP'), condition('label', 'contains', 'TVA'), debit],
  entryLines: payment('44551', false),
}

export const DEMO_COMPANIES: readonly DemoCompany[] = [
  {
    profile: 'atelier-lumen',
    name: 'Atelier Lumen',
    director: CLAIRE_VASSEUR,
    siren: '912345675',
    siret: '91234567500017',
    email: 'contact@atelier-lumen.example',
    phone: '01 23 45 67 89',
    activityCode: '7410Z',
    foundationDate: '2023-03-01',
    legalType: 'SASU',
    legalForm: 'SASU',
    sector: 'services',
    isHolding: false,
    vatRegime: 'normal',
    isVatExempt: false,
    vatExemptReason: null,
    corporateTaxRegime: 'simplified',
    taxOffice: 'SIE de Lyon',
    totalShares: 100,
    shareNominalValue: 10,
    color: '#2f6f5e',
    address: { street: '12 rue des Ateliers', postalCode: '69002', city: 'Lyon' },
    rules: [
      {
        name: 'URSSAF cotisations sociales',
        description: 'Cotisations sur le salaire du président, payées le 15 du mois suivant',
        autoCreate: true,
        priority: 80,
        conditions: [condition('counterparty', 'equals', 'URSSAF'), debit, condition('operationType', 'equals', 'direct_debit')],
        entryLines: payment('431', false),
      },
      {
        name: 'Loyer du studio',
        description: 'Loyer mensuel versé à la SCI Quai des Lumières',
        autoCreate: true,
        priority: 70,
        conditions: [condition('counterparty', 'equals', 'SCI Quai des Lumières'), debit, condition('label', 'contains', 'loyer')],
        entryLines: payment('6132', true),
      },
      {
        name: 'Abonnements logiciels',
        description: 'Logiciel de facturation et suite de création graphique',
        autoCreate: true,
        priority: 60,
        conditions: [
          condition('counterparty', 'regex', '^(Logiciel de facturation|Suite de création graphique)$'),
          debit,
          condition('operationType', 'equals', 'card'),
        ],
        entryLines: payment('651', true),
      },
      BANK_FEES_RULE,
      VAT_PAYMENT_RULE,
      {
        name: 'Carburant du véhicule',
        description: 'Gazole ou essence de la voiture du studio : TVA déductible à 80 % (CGI art. 298-4-1°)',
        autoCreate: false,
        priority: 30,
        conditions: [condition('counterparty', 'startsWith', 'Station-service'), debit, condition('operationType', 'equals', 'card')],
        entryLines: fuelPayment('6061'),
      },
      {
        name: 'Fournitures de bureau',
        description: 'Papeterie et petites fournitures, montants variables',
        autoCreate: false,
        priority: 30,
        conditions: [
          condition('counterparty', 'regex', '^(Papeterie du Centre|Fournitures Bureau Express)$'),
          debit,
          condition('operationType', 'equals', 'card'),
        ],
        entryLines: payment('6064', true),
      },
      {
        name: 'Déplacements en train et VTC',
        description: 'Transport de personnes : TVA non déductible (CGI annexe II art. 206, IV-2-3°)',
        autoCreate: false,
        priority: 30,
        conditions: [condition('counterparty', 'regex', '^(Billet de train|Course VTC)$'), debit, condition('operationType', 'equals', 'card')],
        entryLines: payment('6251', false),
      },
      {
        name: 'Assurance RC Pro',
        description: 'Prélèvement mensuel, hors champ de la TVA',
        autoCreate: true,
        priority: 60,
        conditions: [condition('counterparty', 'equals', 'Assurance RC Pro'), debit, condition('operationType', 'equals', 'direct_debit')],
        entryLines: payment('616', false),
      },
      {
        name: 'Client Maison Verlaine',
        description: 'Règlements du client récurrent Maison Verlaine (TVA sur les encaissements)',
        autoCreate: true,
        priority: 40,
        conditions: [condition('counterparty', 'equals', 'Maison Verlaine'), credit, condition('operationType', 'equals', 'income')],
        entryLines: receipt('706', true),
      },
    ],
  },
  {
    profile: 'maison-verdier',
    name: 'Maison Verdier',
    director: { name: 'Thomas Verdier', login: 'thomas.verdier' },
    siren: '851423699',
    siret: '85142369900012',
    email: 'bonjour@maison-verdier.example',
    phone: '05 56 12 34 56',
    activityCode: '4791B',
    foundationDate: '2021-09-15',
    legalType: 'EURL',
    legalForm: 'EURL',
    sector: 'retail',
    isHolding: false,
    vatRegime: 'normal',
    isVatExempt: false,
    vatExemptReason: null,
    corporateTaxRegime: 'simplified',
    taxOffice: 'SIE de Bordeaux',
    totalShares: 500,
    shareNominalValue: 10,
    color: '#a35a2a',
    address: { street: '27 quai des Chartrons', postalCode: '33000', city: 'Bordeaux' },
    rules: [
      {
        name: 'Versements boutique en ligne',
        description: 'Encaissements CB de la boutique reversés deux fois par semaine (épicerie, TVA 5,5 %)',
        autoCreate: true,
        priority: 60,
        conditions: [condition('counterparty', 'equals', 'Encaissements boutique en ligne'), credit, condition('operationType', 'equals', 'income')],
        entryLines: receipt('707', true),
      },
      {
        name: "Frais d'encaissement CB",
        description: 'Commission mensuelle du prestataire de paiement, exonérée de TVA',
        autoCreate: true,
        priority: 60,
        conditions: [condition('counterparty', 'equals', 'Encaissements boutique en ligne'), debit, condition('operationType', 'equals', 'direct_debit')],
        entryLines: payment('627', false),
      },
      {
        name: "Loyer de l'entrepôt",
        description: 'Loyer mensuel du local de stockage',
        autoCreate: true,
        priority: 70,
        conditions: [condition('counterparty', 'equals', 'Foncière des Docks'), debit, condition('label', 'contains', 'loyer')],
        entryLines: payment('6132', true),
      },
      {
        name: 'Frais de gestion Lumen Holding',
        // The holding's invoice of the month is booked when received (AC,
        // 6226 and VAT): the transfer settles the supplier account.
        description: 'Règlement à la holding de sa facture de frais de gestion du mois (compte fournisseur 401)',
        autoCreate: true,
        priority: 70,
        conditions: [condition('counterparty', 'equals', 'Lumen Holding'), debit, condition('label', 'contains', 'management fees')],
        entryLines: payment('401', false),
      },
      {
        name: 'Abonnement plateforme e-commerce',
        description: 'Abonnement mensuel à la plateforme de la boutique en ligne',
        autoCreate: true,
        priority: 60,
        conditions: [condition('counterparty', 'equals', 'Plateforme boutique en ligne'), debit, condition('operationType', 'equals', 'card')],
        entryLines: payment('6135', true),
      },
      {
        name: 'Expéditions transporteur',
        description: 'Étiquettes et frais de port des colis clients',
        autoCreate: true,
        priority: 40,
        conditions: [condition('counterparty', 'equals', 'Transporteur colis'), debit, condition('operationType', 'equals', 'card')],
        entryLines: payment('6242', true),
      },
      {
        name: 'Fournitures de bureau',
        description: 'Papeterie, montants variables',
        autoCreate: false,
        priority: 30,
        conditions: [condition('counterparty', 'equals', 'Papeterie du Centre'), debit, condition('operationType', 'equals', 'card')],
        entryLines: payment('6064', true),
      },
      BANK_FEES_RULE,
      VAT_PAYMENT_RULE,
    ],
  },
  {
    profile: 'sci-les-tilleuls',
    name: 'SCI Les Tilleuls',
    director: { name: 'Hélène Garnier', login: 'helene.garnier' },
    siren: '894273515',
    siret: '89427351500011',
    email: 'gerance@sci-les-tilleuls.example',
    phone: '04 72 98 76 54',
    activityCode: '6820A',
    foundationDate: '2022-05-10',
    legalType: 'SCI',
    legalForm: 'SCI',
    sector: 'real-estate',
    isHolding: false,
    vatRegime: null,
    isVatExempt: true,
    vatExemptReason: "Location de locaux d'habitation nus, exonérée (CGI art. 261 D 2°)",
    corporateTaxRegime: 'simplified',
    taxOffice: 'SIE de Lyon',
    totalShares: 100,
    shareNominalValue: 10,
    color: '#6b7f3a',
    address: { street: '14 rue des Tilleuls', postalCode: '69006', city: 'Lyon' },
    rules: [
      {
        name: 'Loyers des locataires',
        description: 'Virements mensuels des locataires, loyers exonérés de TVA',
        autoCreate: true,
        priority: 70,
        conditions: [condition('label', 'contains', 'LOYER'), credit, condition('operationType', 'equals', 'income')],
        entryLines: receipt('706', false),
      },
      {
        name: 'Honoraires de gestion locative',
        description: "Honoraires de l'agence, TVA non récupérable (SCI hors TVA)",
        autoCreate: true,
        priority: 60,
        conditions: [condition('counterparty', 'equals', 'Saône Gestion Immobilière'), debit, condition('operationType', 'equals', 'direct_debit')],
        entryLines: payment('6226', false),
      },
      {
        name: 'Assurance propriétaire non occupant',
        description: 'Prélèvement mensuel, hors champ de la TVA',
        autoCreate: true,
        priority: 60,
        conditions: [condition('counterparty', 'equals', 'Assurance PNO'), debit, condition('operationType', 'equals', 'direct_debit')],
        entryLines: payment('616', false),
      },
      {
        name: 'Taxe foncière',
        description: 'Prélèvement DGFiP de la taxe foncière',
        autoCreate: true,
        priority: 80,
        conditions: [condition('counterparty', 'equals', 'DGFiP'), condition('label', 'contains', 'Taxe foncière'), debit],
        entryLines: payment('63512', false),
      },
      { ...BANK_FEES_RULE, entryLines: payment('627', false) },
    ],
  },
  {
    profile: 'lumen-holding',
    name: 'Lumen Holding',
    director: CLAIRE_VASSEUR,
    siren: '908732142',
    siret: '90873214200017',
    email: `${HOLDING_FOUNDER.toLowerCase().replace(/\s+/g, '.')}@lumen-holding.example`,
    phone: '04 78 12 34 56',
    activityCode: '7010Z',
    foundationDate: '2024-06-03',
    legalType: 'SAS',
    legalForm: 'SAS',
    sector: 'finance',
    isHolding: true,
    vatRegime: 'normal',
    servicesVatOnDebits: true,
    isVatExempt: false,
    vatExemptReason: null,
    corporateTaxRegime: 'simplified',
    taxOffice: 'SIE de Lyon',
    // The contributions of the titres (group.ts HOLDING_CAPITAL): 240,000 EUR.
    totalShares: 24000,
    shareNominalValue: 10,
    color: '#3a5a8c',
    address: { street: '12 rue des Ateliers', postalCode: '69002', city: 'Lyon' },
    rules: [
      ...['Atelier Lumen', 'Maison Verdier'].map(
        (subsidiary): DemoRule => ({
          name: `Frais de gestion ${subsidiary}`,
          // The invoice of the month (Frais de gestion, then Factures de vente)
          // carries the revenue and the VAT (on debits): the transfer settles
          // the customer account, and the payment is then recorded on the invoice.
          description: 'Règlement par la filiale de la facture de frais de gestion du mois (compte client 411)',
          autoCreate: true,
          priority: 70,
          conditions: [condition('counterparty', 'equals', subsidiary), credit, condition('label', 'contains', 'management fees')],
          entryLines: receipt('411', false),
        }),
      ),
      {
        name: 'Honoraires expert-comptable',
        description: 'Honoraires trimestriels du cabinet comptable',
        autoCreate: true,
        priority: 60,
        conditions: [condition('counterparty', 'equals', 'Cabinet Comptable Rive Gauche'), debit, condition('operationType', 'equals', 'transfer')],
        entryLines: payment('6226', true),
      },
      BANK_FEES_RULE,
      VAT_PAYMENT_RULE,
    ],
  },
]
