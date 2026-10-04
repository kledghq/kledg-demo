/**
 * Registry of the demo companies' bank profiles: one simulated Qonto
 * organization per company, each with its own bank account on the fictitious
 * bank code 99999 and its own API login (secret key "demo" for all).
 */

import { DemoProfileEngine, type ProfileSpec } from '../engine'
import { ATELIER_LUMEN_SPEC } from './atelier-lumen'
import { MAISON_VERDIER_SPEC } from './maison-verdier'
import { SCI_LES_TILLEULS_SPEC } from './sci-les-tilleuls'
import { LUMEN_HOLDING_SPEC } from './lumen-holding'
import { DEMO_BANK_CODE, frenchIban } from './shared'

/**
 * Domestic account number (RIB) of every demo bank account; the companies
 * differ by branch (guichet). Kledg's example statements
 * (public/examples/exemple-releve.ofx, offered by the statement import
 * dialog) name this account (bank 99999, ACCTID 00000000001), so importing
 * them on a demo account matches it instead of warning about another
 * account (lib/banking/import/importer.ts selectAccountTransactions).
 */
export const DEMO_ACCOUNT_NUMBER = '00000000001'

/** The simulated API only exposes this many days of history. */
export const DEMO_API_HISTORY_DAYS = 120

export interface DemoBankAccount {
  id: string
  slug: string
  name: string
  iban: string
  bic: string
  currency: string
}

export interface DemoBankProfile {
  engine: DemoProfileEngine
  /** Qonto API login (the secret key is DEMO_QONTO_SECRET). */
  login: string
  organization: { id: string; slug: string; legalName: string }
  bankAccount: DemoBankAccount
  /** Company named on the generated receipts. */
  receiptCustomer: string
}

function profile(
  spec: ProfileSpec,
  login: string,
  legalName: string,
  receiptCustomer: string,
  ids: { organization: string; account: string; branch: string; number: string }
): DemoBankProfile {
  return {
    engine: new DemoProfileEngine(spec),
    login,
    organization: { id: ids.organization, slug: spec.slug, legalName },
    bankAccount: {
      id: ids.account,
      slug: `${spec.slug}-compte-principal`,
      name: 'Compte principal',
      iban: frenchIban(DEMO_BANK_CODE, ids.branch, ids.number),
      bic: 'DEMOFRPPXXX',
      currency: 'EUR',
    },
    receiptCustomer,
  }
}

export const DEMO_PROFILES: readonly DemoBankProfile[] = [
  profile(ATELIER_LUMEN_SPEC, 'demo', 'Atelier Lumen', 'Atelier Lumen SASU', {
    organization: '3c9b1f6e-2d4a-4b8e-9f10-6a5c7e2d1b00',
    account: '7d1f3c2a-0b6e-4c55-9a1e-5f2d8c4b9a01',
    branch: '00001',
    number: DEMO_ACCOUNT_NUMBER,
  }),
  profile(MAISON_VERDIER_SPEC, 'demo-maison-verdier', 'Maison Verdier', 'Maison Verdier EURL', {
    organization: '5a2e8d41-7c3b-4f19-8e62-0b4d9a7c3e11',
    account: '9e4b2c7d-1a5f-4d83-b6c0-3f8e2a1d7b22',
    branch: '00002',
    number: DEMO_ACCOUNT_NUMBER,
  }),
  profile(SCI_LES_TILLEULS_SPEC, 'demo-sci-les-tilleuls', 'SCI Les Tilleuls', 'SCI Les Tilleuls', {
    organization: '1f7c3a9e-6b2d-4e48-a1f5-7d0c8b3e6a33',
    account: '4c8a1e6f-3d7b-4a92-8f1e-6b5d2c9a0e44',
    branch: '00003',
    number: DEMO_ACCOUNT_NUMBER,
  }),
  profile(LUMEN_HOLDING_SPEC, 'demo-lumen-holding', 'Lumen Holding', 'Lumen Holding SAS', {
    organization: '8b5d2f1a-9e4c-4c67-b3a8-2e7f1d6c9b55',
    account: '2a6f9c3e-8d1b-4b75-a4e2-9c3f7a5d1e66',
    branch: '00004',
    number: DEMO_ACCOUNT_NUMBER,
  }),
]

export function profileBySlug(slug: string): DemoBankProfile {
  const found = DEMO_PROFILES.find((p) => p.engine.slug === slug)
  if (!found) throw new Error(`Unknown demo profile ${slug}`)
  return found
}

export function profileByLogin(login: string): DemoBankProfile | null {
  return DEMO_PROFILES.find((p) => p.login === login) ?? null
}
