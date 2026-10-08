/**
 * Simulated Qonto Business API (v2) for the demo instance.
 *
 * Implements the endpoints the Kledg Qonto integration calls (see
 * lib/integrations/providers/qonto) with data from the deterministic
 * engine. Every company of every sandbox has its own credentials
 * (./credentials.ts): the login names the company profile and the sandbox,
 * so each visitor's integration reads its own account. The generated
 * activity is the same for every sandbox; receipt ids are made unique per
 * sandbox (Kledg stores them with a unique constraint). Served by
 * app/api/demo/qonto/v2/[...path]/route.ts, and called in-process by the
 * demo seed (./provider.ts).
 */

import { addDays, fakeUuid, toDateKey, type DemoTransaction } from './engine'
import { authenticateDemoQonto, type DemoQontoTenant } from './credentials'
import { DEMO_API_HISTORY_DAYS, DEMO_PROFILES, type DemoBankProfile } from './profiles'
import { buildReceiptPdf } from './receipt-pdf'
import { isSandboxKey } from '@/lib/demo/sandbox/identity'

export interface DemoQontoRequest {
  method: string
  /** Path segments after /v2, e.g. ['transactions'] */
  path: string[]
  searchParams: URLSearchParams
  authorization: string | null
  /** Public base URL of the simulated API, used to build file URLs. */
  baseUrl: string
  now?: Date
}

export type DemoQontoResponse =
  | { status: number; json: unknown; tenant?: DemoQontoTenant }
  | { status: number; body: Buffer; contentType: string; tenant?: DemoQontoTenant }

/** Id of a receipt in a sandbox: unique per sandbox, stable for a given receipt. */
export function sandboxAttachmentId(sandboxKey: string, attachmentId: string): string {
  return fakeUuid(`${sandboxKey}:${attachmentId}`)
}

function error(status: number, detail: string): DemoQontoResponse {
  return { status, json: { errors: [{ code: status === 401 ? 'unauthorized' : 'not_found', detail }] } }
}

function meta(page: number, perPage: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  return {
    current_page: page,
    next_page: page < totalPages ? page + 1 : null,
    prev_page: page > 1 ? page - 1 : null,
    total_pages: totalPages,
    total_count: total,
    per_page: perPage,
  }
}

function emptyList(key: string, searchParams: URLSearchParams): DemoQontoResponse {
  const perPage = Number(searchParams.get('per_page')) || 100
  return { status: 200, json: { [key]: [], meta: meta(1, perPage, 0) } }
}

function toCents(value: number): number {
  return Math.round(value * 100)
}

function bankAccountPayload(profile: DemoBankProfile, now: Date) {
  const balance = profile.engine.balance(now)
  const account = profile.bankAccount
  return {
    id: account.id,
    slug: account.slug,
    name: account.name,
    iban: account.iban,
    bic: account.bic,
    currency: account.currency,
    balance,
    balance_cents: toCents(balance),
    authorized_balance: balance,
    authorized_balance_cents: toCents(balance),
    status: 'active',
    main: true,
    is_external_account: false,
    updated_at: now.toISOString(),
  }
}

function transactionPayload(profile: DemoBankProfile, tx: DemoTransaction, sandboxKey: string) {
  return {
    id: tx.id,
    transaction_id: tx.transactionId,
    amount: tx.amount,
    amount_cents: toCents(tx.amount),
    local_amount: tx.amount,
    local_amount_cents: toCents(tx.amount),
    side: tx.side,
    operation_type: tx.operationType,
    currency: 'EUR',
    local_currency: 'EUR',
    label: tx.label,
    clean_counterparty_name: tx.counterparty,
    settled_at: tx.settledAt,
    emitted_at: tx.settledAt,
    created_at: tx.settledAt,
    updated_at: tx.settledAt,
    status: 'completed',
    note: null,
    reference: tx.reference,
    vat_amount: tx.vatRate === null ? null : tx.vatAmount,
    vat_amount_cents: tx.vatRate === null ? null : toCents(tx.vatAmount),
    vat_rate: tx.vatRate,
    category: tx.category,
    cashflow_category: null,
    cashflow_subcategory: null,
    attachment_ids: tx.attachmentIds.map((a) => sandboxAttachmentId(sandboxKey, a)),
    attachment_lost: false,
    attachment_required: tx.side === 'debit',
    label_ids: [],
    logo: null,
    bank_account_id: profile.bankAccount.id,
    subject_type: tx.operationType === 'card' ? 'Card' : 'Transfer',
    card_last_digits: tx.operationType === 'card' ? '4242' : null,
    is_external_transaction: false,
  }
}

/** `attachmentId` is the sandbox id (sandboxAttachmentId). */
function attachmentPayload(attachmentId: string, tx: DemoTransaction, baseUrl: string, sandboxKey: string) {
  const fileUrl = `${baseUrl}/files/${sandboxKey}/${attachmentId}.pdf`
  return {
    id: attachmentId,
    created_at: tx.settledAt,
    updated_at: tx.settledAt,
    file_name: `justificatif-${tx.transactionId}.pdf`,
    file_size: 1200,
    file_content_type: 'application/pdf',
    file_url: fileUrl,
    url: fileUrl,
  }
}

function listTransactions(
  profile: DemoBankProfile,
  sandboxKey: string,
  searchParams: URLSearchParams,
  now: Date,
): DemoQontoResponse {
  const iban = searchParams.get('iban')
  const bankAccountId = searchParams.get('bank_account_id')
  if (iban && iban.replace(/\s/g, '') !== profile.bankAccount.iban) {
    return error(404, 'Bank account not found')
  }
  if (bankAccountId && bankAccountId !== profile.bankAccount.id) {
    return error(404, 'Bank account not found')
  }

  const statuses = searchParams.getAll('status[]')
  if (statuses.length > 0 && !statuses.includes('completed')) {
    return emptyList('transactions', searchParams)
  }

  const nowIso = now.toISOString()
  const today = toDateKey(now)
  const windowStart = addDays(today, -DEMO_API_HISTORY_DAYS)

  const settledFrom = searchParams.get('settled_at_from') ?? searchParams.get('updated_at_from')
  const settledTo = searchParams.get('settled_at_to') ?? searchParams.get('updated_at_to')
  const fromIso = settledFrom ? new Date(settledFrom).toISOString() : null
  const toIso = settledTo ? new Date(settledTo).toISOString() : null

  const all = profile.engine
    .transactions(windowStart, today)
    .filter((tx) => tx.settledAt <= nowIso)
    .filter((tx) => !fromIso || tx.settledAt >= fromIso)
    .filter((tx) => !toIso || tx.settledAt <= toIso)

  const sort = searchParams.get('sort_by') ?? 'settled_at:desc'
  all.sort((a, b) => a.settledAt.localeCompare(b.settledAt))
  if (sort.endsWith(':desc')) all.reverse()

  const perPage = Math.min(Math.max(Number(searchParams.get('per_page')) || 100, 1), 100)
  const page = Math.max(Number(searchParams.get('current_page') ?? searchParams.get('page')) || 1, 1)
  const slice = all.slice((page - 1) * perPage, page * perPage)

  return {
    status: 200,
    json: { transactions: slice.map((tx) => transactionPayload(profile, tx, sandboxKey)), meta: meta(page, perPage, all.length) },
  }
}

/** Transaction owning a sandbox receipt id, searched in the API window of `profiles`. */
function findByAttachment(
  profiles: readonly DemoBankProfile[],
  sandboxKey: string,
  attachmentId: string,
  now: Date,
): { profile: DemoBankProfile; tx: DemoTransaction } | null {
  const today = toDateKey(now)
  for (const profile of profiles) {
    const tx = profile.engine
      .transactions(addDays(today, -DEMO_API_HISTORY_DAYS), today)
      .find((t) => t.attachmentIds.some((a) => sandboxAttachmentId(sandboxKey, a) === attachmentId))
    if (tx) return { profile, tx }
  }
  return null
}

export function handleDemoQontoRequest(request: DemoQontoRequest): DemoQontoResponse {
  const now = request.now ?? new Date()
  const [resource, id, sub] = request.path
  const method = request.method.toUpperCase()

  // Receipts are downloaded from their URL without credentials, like Qonto's
  // pre-signed file URLs: /files/<sandbox key>/<receipt id>.pdf.
  if (resource === 'files') {
    if (!id || !sub || !isSandboxKey(id)) return error(404, 'File not found')
    const found = findByAttachment(DEMO_PROFILES, id, sub.replace(/\.pdf$/, ''), now)
    if (!found) return error(404, 'File not found')
    const { profile, tx } = found
    const [y, m, d] = tx.date.split('-')
    const net = (tx.amount - tx.vatAmount).toFixed(2)
    const pdf = buildReceiptPdf(`Justificatif ${tx.counterparty}`, [
      `Date : ${d}/${m}/${y}`,
      `Libellé : ${tx.label}`,
      `Montant HT : ${net} EUR`,
      `TVA${tx.vatRate !== null ? ` (${tx.vatRate} %)` : ''} : ${tx.vatAmount.toFixed(2)} EUR`,
      `Montant TTC : ${tx.amount.toFixed(2)} EUR`,
      `Client : ${profile.receiptCustomer}`,
    ])
    return { status: 200, body: pdf, contentType: 'application/pdf' }
  }

  const tenant = authenticateDemoQonto(request.authorization)
  if (!tenant) {
    return error(401, 'Invalid credentials. Each company of a demo sandbox has its own API key, stored in its Qonto integration.')
  }
  return { ...authorizedResponse(tenant, request, resource, id, sub, method, now), tenant }
}

function authorizedResponse(
  tenant: DemoQontoTenant,
  request: DemoQontoRequest,
  resource: string | undefined,
  id: string | undefined,
  sub: string | undefined,
  method: string,
  now: Date,
): DemoQontoResponse {
  const { profile, sandboxKey } = tenant

  switch (resource) {
    case 'organization':
      return {
        status: 200,
        json: {
          organization: {
            id: profile.organization.id,
            slug: profile.organization.slug,
            legal_name: profile.organization.legalName,
            locale: 'fr',
            bank_accounts: [bankAccountPayload(profile, now)],
          },
        },
      }

    case 'bank_accounts':
      return { status: 200, json: { bank_accounts: [bankAccountPayload(profile, now)], meta: meta(1, 100, 1) } }

    case 'transactions': {
      if (!id) return listTransactions(profile, sandboxKey, request.searchParams, now)
      const tx = profile.engine.find(id, now, DEMO_API_HISTORY_DAYS)
      if (!tx || tx.settledAt > now.toISOString()) return error(404, 'Transaction not found')
      if (sub === 'attachments') {
        if (method === 'POST') return { status: 200, json: {} }
        return {
          status: 200,
          json: {
            attachments: tx.attachmentIds.map((a) =>
              attachmentPayload(sandboxAttachmentId(sandboxKey, a), tx, request.baseUrl, sandboxKey),
            ),
          },
        }
      }
      return { status: 200, json: { transaction: transactionPayload(profile, tx, sandboxKey) } }
    }

    case 'attachments': {
      if (!id) return error(404, 'Attachment not found')
      const found = findByAttachment([profile], sandboxKey, id, now)
      if (!found) return error(404, 'Attachment not found')
      const attachment = attachmentPayload(id, found.tx, request.baseUrl, sandboxKey)
      // The Kledg client reads the fields at the top level; Qonto wraps them.
      return { status: 200, json: { ...attachment, attachment } }
    }

    case 'statements':
      if (id) return error(404, 'Statement not found')
      return emptyList('statements', request.searchParams)
    case 'labels':
      return emptyList('labels', request.searchParams)
    case 'memberships':
      return emptyList('memberships', request.searchParams)
    // Qonto's invoicing (Factures, "Importer depuis Qonto", lib/invoices/import-qonto-invoices.service.ts):
    // the simulated organizations issue and receive their invoices in Kledg, none in Qonto.
    case 'clients':
    case 'client_invoices':
    case 'supplier_invoices':
      if (id) return error(404, 'Not found')
      return emptyList(resource, request.searchParams)
    default:
      return error(404, `Unknown endpoint /${request.path.join('/')}`)
  }
}
