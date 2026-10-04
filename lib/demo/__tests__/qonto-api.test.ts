import { beforeAll, describe, expect, it } from 'vitest'
import { addDays } from '../qonto/engine'
import { DEMO_API_HISTORY_DAYS, DEMO_PROFILES, profileBySlug } from '../qonto/profiles'
import { handleDemoQontoRequest, sandboxAttachmentId } from '../qonto/api'
import { authenticateDemoQonto, demoQontoCredentials, demoQontoSecret, demoQontoTenantOfLogin } from '../qonto/credentials'
import { InProcessDemoQontoProvider } from '../qonto/provider'

const SANDBOX = 'k3x9ab'
const OTHER = 'zz12yy'
const now = new Date('2026-10-02T12:00:00Z')
const lumenProfile = profileBySlug('atelier-lumen')
const verdierProfile = profileBySlug('maison-verdier')

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
})

const auth = (profile = lumenProfile, sandbox = SANDBOX) => {
  const { login, secretKey } = demoQontoCredentials(profile, sandbox)
  return `${login}:${secretKey}`
}

const call = (path: string[], params: Record<string, string> = {}, authorization: string | null = auth()) =>
  handleDemoQontoRequest({
    method: 'GET',
    path,
    searchParams: new URLSearchParams(params),
    authorization,
    baseUrl: 'http://localhost/api/demo/qonto/v2',
    now,
  })

type OrganizationJson = { organization: { slug: string; bank_accounts: Array<{ iban: string; balance: number }> } }
type TransactionsJson = {
  transactions: Array<{ settled_at: string; transaction_id: string; attachment_ids: string[] }>
  meta: { total_count: number; next_page: number | null }
}

describe('simulated Qonto API credentials (one pair per company of each sandbox)', () => {
  it('derives a login naming the company and the sandbox, and a secret only the instance can compute', () => {
    const { login, secretKey } = demoQontoCredentials(verdierProfile, SANDBOX)
    expect(login).toBe(`demo-maison-verdier-${SANDBOX}`)
    expect(secretKey).toMatch(/^[0-9a-f]{40}$/)
    expect(demoQontoTenantOfLogin(login)).toMatchObject({ profile: verdierProfile, sandboxKey: SANDBOX })
    expect(demoQontoCredentials(verdierProfile, OTHER).secretKey).not.toBe(secretKey)
    expect(demoQontoSecret(login)).toBe(secretKey)
  })

  it('refuses the shared logins of the first demo version and any other credentials', () => {
    expect(call(['organization'], {}, 'demo:demo').status).toBe(401)
    expect(call(['organization'], {}, 'demo-maison-verdier:demo').status).toBe(401)
    expect(call(['organization'], {}, 'someone:secret').status).toBe(401)
    expect(call(['organization'], {}, null).status).toBe(401)
    expect(call(['organization'], {}, `demo-${SANDBOX}:`).status).toBe(401)
  })

  it("refuses a sandbox's login with another sandbox's secret", () => {
    const mine = demoQontoCredentials(lumenProfile, SANDBOX)
    const theirs = demoQontoCredentials(lumenProfile, OTHER)
    expect(authenticateDemoQonto(`${theirs.login}:${mine.secretKey}`)).toBeNull()
    expect(call(['organization'], {}, `${theirs.login}:${mine.secretKey}`).status).toBe(401)
    expect(authenticateDemoQonto(`${theirs.login}:${theirs.secretKey}`)?.sandboxKey).toBe(OTHER)
  })
})

describe('simulated Qonto API', () => {
  it('serves each company its own organization and bank account', () => {
    const ibans = new Set<string>()
    for (const profile of DEMO_PROFILES) {
      const res = call(['organization'], {}, auth(profile))
      expect(res.status).toBe(200)
      const json = (res as { json: OrganizationJson }).json
      expect(json.organization.slug).toBe(profile.engine.slug)
      expect(json.organization.bank_accounts).toHaveLength(1)
      expect(json.organization.bank_accounts[0].iban).toBe(profile.bankAccount.iban)
      expect(json.organization.bank_accounts[0].balance).toBe(profile.engine.balance(now))
      ibans.add(profile.bankAccount.iban)
    }
    expect(ibans.size).toBe(DEMO_PROFILES.length)
  })

  it('paginates transactions within the history window and hides future ones', () => {
    const res = call(['transactions'], { iban: lumenProfile.bankAccount.iban, per_page: '50', page: '1' })
    const json = (res as { json: TransactionsJson }).json
    expect(json.transactions).toHaveLength(50)
    expect(json.meta.next_page).toBe(2)
    const windowStart = addDays('2026-10-02', -DEMO_API_HISTORY_DAYS)
    const expected = lumenProfile.engine.transactions(windowStart, '2026-10-02').filter((t) => t.settledAt <= now.toISOString())
    expect(json.meta.total_count).toBe(expected.length)
    for (const tx of json.transactions) expect(tx.settled_at <= now.toISOString()).toBe(true)
  })

  it("refuses another company's IBAN", () => {
    expect(call(['transactions'], { iban: verdierProfile.bankAccount.iban }).status).toBe(404)
  })

  it('filters by settled_at_from', () => {
    const res = call(['transactions'], { iban: verdierProfile.bankAccount.iban, settled_at_from: '2026-09-28T00:00:00Z' }, auth(verdierProfile))
    const json = (res as { json: TransactionsJson }).json
    expect(json.transactions.length).toBeGreaterThan(0)
    for (const tx of json.transactions) {
      expect(tx.settled_at >= '2026-09-28').toBe(true)
      expect(tx.transaction_id.startsWith('maison-verdier-')).toBe(true)
    }
  })

  it('returns a valid empty statements list', () => {
    const res = call(['statements'])
    expect(res.status).toBe(200)
    const json = (res as { json: Record<string, unknown> }).json
    expect(json.statements).toEqual([])
    expect(json.meta).toMatchObject({ current_page: 1, next_page: null, total_count: 0 })
  })

  it('answers the invoicing endpoints of the Qonto invoice import with empty lists (no invoice in the simulated Qonto)', () => {
    for (const resource of ['clients', 'client_invoices', 'supplier_invoices']) {
      const res = call([resource], { page: '1', per_page: '100' })
      expect(res.status, resource).toBe(200)
      const json = (res as { json: Record<string, unknown> }).json
      expect(json[resource]).toEqual([])
      expect(json.meta).toMatchObject({ next_page: null, total_count: 0 })
      expect(call([resource, 'some-id']).status).toBe(404)
    }
  })

  it('gives each sandbox its own receipt ids (stored with a unique constraint), with their PDF file', () => {
    for (const profile of DEMO_PROFILES) {
      const tx = profile.engine.transactions('2026-09-01', '2026-09-30').find((t) => t.attachmentIds.length > 0)!
      const mine = sandboxAttachmentId(SANDBOX, tx.attachmentIds[0])
      const theirs = sandboxAttachmentId(OTHER, tx.attachmentIds[0])
      expect(mine).not.toBe(theirs)

      const listed = call(['transactions', tx.id, 'attachments'], {}, auth(profile))
      const attachments = (listed as { json: { attachments: Array<{ id: string; url: string }> } }).json.attachments
      expect(attachments.map((a) => a.id)).toEqual([mine])
      expect(attachments[0].url).toBe(`http://localhost/api/demo/qonto/v2/files/${SANDBOX}/${mine}.pdf`)

      expect(call(['attachments', mine], {}, auth(profile)).status).toBe(200)
      // Another sandbox's receipt id is unknown to this sandbox.
      expect(call(['attachments', theirs], {}, auth(profile)).status).toBe(404)

      const file = call(['files', SANDBOX, `${mine}.pdf`], {}, null)
      expect(file.status).toBe(200)
      expect('body' in file && file.body.subarray(0, 5).toString()).toBe('%PDF-')
      expect(call(['files', OTHER, `${mine}.pdf`], {}, null).status).toBe(404)
    }
  })

  it('names the authenticated sandbox in its answer (activity)', () => {
    expect(call(['organization']).tenant?.sandboxKey).toBe(SANDBOX)
    expect(call(['organization'], {}, null).tenant).toBeUndefined()
  })
})

describe('in-process provider used by the seed', () => {
  it('maps the API payloads like the Qonto provider, without any HTTP call', async () => {
    const provider = new InProcessDemoQontoProvider(demoQontoCredentials(lumenProfile, SANDBOX), 'https://demo.example/api/demo/qonto/v2', now)
    const [account] = await provider.listAccounts()
    expect(account).toMatchObject({ externalId: lumenProfile.bankAccount.iban, iban: lumenProfile.bankAccount.iban })
    const transactions = await provider.syncTransactions(account.externalId, new Date('2026-09-01T00:00:00Z'))
    const expected = lumenProfile.engine.transactions('2026-09-01', '2026-10-02').filter((t) => t.settledAt <= now.toISOString())
    expect(transactions.map((t) => t.externalId)).toEqual(expect.arrayContaining(expected.map((t) => t.transactionId)))
    expect(transactions).toHaveLength(expected.length)
    const withReceipt = transactions.find((t) => (t.providerData?.attachment_ids as string[]).length > 0)!
    expect((withReceipt.providerData?.attachment_ids as string[])[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('fails loudly with credentials the API refuses', async () => {
    const provider = new InProcessDemoQontoProvider({ login: `demo-${SANDBOX}`, secretKey: 'wrong' }, 'https://x', now)
    await expect(provider.listAccounts()).rejects.toThrow('401')
  })
})
