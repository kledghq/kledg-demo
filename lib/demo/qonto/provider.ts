/**
 * Bank provider answered in-process by the simulated Qonto API, for the
 * demo seed: syncIntegration (lib/integrations/sync.ts) takes it as its
 * injected provider, so seeding a sandbox makes no HTTP call and patches
 * nothing global (several sandboxes can be seeded at once). The payloads are
 * the API's own and are mapped by Kledg's Qonto mapping, so the stored rows
 * are those a sync over HTTP would store.
 */

import { ExternalServiceError } from '@/lib/accounting/errors'
import { mapQontoTransaction } from '@/lib/banking/providers/qonto'
import type {
  BankProvider,
  ConnectionHealth,
  ProviderAccount,
  ProviderBalance,
  ProviderTransaction,
} from '@/lib/banking/providers/types'
import type { QontoAccount, QontoTransaction } from '@/lib/integrations/providers/qonto/types'
import { handleDemoQontoRequest } from './api'

interface OrganizationJson {
  organization: { bank_accounts: QontoAccount[] }
}

interface TransactionsJson {
  transactions: QontoTransaction[]
  meta: { next_page: number | null }
}

export class InProcessDemoQontoProvider implements BankProvider {
  readonly id = 'QONTO' as const
  readonly kind = 'direct' as const

  /**
   * `baseUrl` is the public URL of the simulated API (QONTO_API_URL): the
   * receipt URLs stored with the transactions point there.
   */
  constructor(
    private readonly credentials: { login: string; secretKey: string },
    private readonly baseUrl: string,
    private readonly now?: Date,
  ) {}

  private call<T>(path: string[], params: Record<string, string> = {}): T {
    const response = handleDemoQontoRequest({
      method: 'GET',
      path,
      searchParams: new URLSearchParams(params),
      authorization: `${this.credentials.login}:${this.credentials.secretKey}`,
      baseUrl: this.baseUrl,
      now: this.now,
    })
    if (!('json' in response) || response.status !== 200) {
      throw new ExternalServiceError(`API Qonto simulée : erreur ${response.status} sur /${path.join('/')}`)
    }
    return response.json as T
  }

  private accounts(): QontoAccount[] {
    return this.call<OrganizationJson>(['organization']).organization.bank_accounts
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    return this.accounts().map((account) => ({
      externalId: account.iban,
      iban: account.iban,
      name: account.slug || account.iban,
      balance: account.balance,
      currency: account.currency,
      providerData: account as unknown as Record<string, unknown>,
    }))
  }

  async syncTransactions(accountExternalId: string, since?: Date): Promise<ProviderTransaction[]> {
    const account = this.accounts().find((a) => a.iban === accountExternalId || a.id === accountExternalId)
    if (!account) return []
    const all: QontoTransaction[] = []
    for (let page: number | null = 1; page; ) {
      const json: TransactionsJson = this.call<TransactionsJson>(['transactions'], {
        bank_account_id: account.id,
        per_page: '100',
        page: String(page),
        ...(since ? { settled_at_from: `${since.toISOString().slice(0, 10)}T00:00:00Z` } : {}),
      })
      all.push(...json.transactions)
      page = json.meta.next_page
    }
    return all.map((t) => mapQontoTransaction(t, accountExternalId))
  }

  async getBalances(): Promise<ProviderBalance[]> {
    return this.accounts().map((a) => ({
      accountExternalId: a.iban,
      current: a.balance,
      available: a.authorized_balance ?? null,
      currency: a.currency,
    }))
  }

  async getConnectionHealth(): Promise<ConnectionHealth> {
    return { lastSyncAt: null, consentExpiresAt: null, error: null }
  }
}
