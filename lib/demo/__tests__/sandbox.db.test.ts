/**
 * Private demo sandboxes against PostgreSQL (lib/__tests__/helpers/test-db.ts):
 * - "Entrer dans la démo": a sandbox account (plain user, random password)
 *   with its own four companies, signed in with Better Auth's cookies;
 * - two visitors created at once get two independent sandboxes;
 * - isolation: company list, direct access by id, sample files, simulated
 *   Qonto credentials and bank data of another sandbox are out of reach;
 * - "Réinitialiser ma démo": companies rebuilt, same account and session,
 *   the other sandbox untouched;
 * - the cap (recycling an idle sandbox, else a friendly refusal), the
 *   per-IP rate limit, and the nightly cleanup (CRON_SECRET) that deletes
 *   inactive sandboxes with every row;
 * - receipts dropped on Justificatifs stay in PostgreSQL (no object storage
 *   on the demo) and go with the sandbox's companies (reset, recycling and
 *   cleanup).
 *
 * The session is mocked (getCurrentUser), and next/headers gives the action
 * a client IP and a cookie store. Skipped when the test database server is
 * unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('demo_sandbox')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'https://demo.example.com'
  process.env.KLEDG_DEMO_MODE = 'true'
  process.env.QONTO_API_URL = 'https://demo.example.com/api/demo/qonto/v2'
  process.env.CRON_SECRET = 'cron-secret-for-tests'
  delete process.env.RATE_LIMIT_DISABLED
  // The demo has no object storage: receipts stay in PostgreSQL (lib/storage/config.ts).
  for (const name of ['KLEDG_STORAGE_DRIVER', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'KLEDG_S3_BUCKET', 'KLEDG_STORAGE_DIR']) delete process.env[name]
  // Kledg trusts a proxy header for the client IP only by configuration (lib/client-ip.ts).
  process.env.RATE_LIMIT_IP_HEADER = 'x-real-ip'
  return {
    user: null as null | { id: string; email: string; name: string | null; role: string | null },
    cookies: new Map<string, { value: string; options: Record<string, unknown> }>(),
    ip: '198.51.100.1',
  }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': state.ip, 'user-agent': 'vitest' }),
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => state.cookies.set(name, { value, options }),
  }),
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Service = typeof import('../sandbox/service')
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: Prisma
let service: Service

interface Visitor {
  id: string
  email: string
  key: string
  companies: Array<{ id: string; slug: string }>
}

async function visitor(userId: string): Promise<Visitor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const companies = await prisma.company.findMany({
    where: { organization: { members: { some: { userId } } } },
    orderBy: { name: 'asc' },
    select: { id: true, slug: true },
  })
  return { id: user.id, email: user.email, key: user.email.slice('visiteur-'.length, 'visiteur-'.length + 6), companies }
}

function as(v: Visitor | null) {
  state.user = v ? { id: v.id, email: v.email, name: 'Visiteur', role: 'user' } : null
}

async function get(route: () => Promise<unknown>, path: string, params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const handler = ((await route()) as { GET: Handler }).GET
  return handler(new NextRequest(`https://demo.example.com${path}`, { headers }), { params: Promise.resolve(params) })
}

const companiesRoute = () => import('@/app/api/companies/route')
const companyRoute = () => import('@/app/api/companies/[id]/route')
const samplesRoute = () => import('@/app/api/demo/samples/route')
const cronRoute = () => import('@/app/api/cron/reset-demo/route')
const stagedRoute = () => import('@/app/api/receipts/staged/route')

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 7])

/** Drops a receipt on the Justificatifs page of `companyId`, as `v`, through Kledg's route. */
async function dropReceipt(v: Visitor, companyId: string, name: string): Promise<Response> {
  as(v)
  const form = new FormData()
  form.set('companyId', companyId)
  form.set('file', new File([JPEG], name, { type: 'image/jpeg' }))
  const handler = ((await stagedRoute()) as unknown as { POST: Handler }).POST
  return handler(new NextRequest('https://demo.example.com/api/receipts/staged', { method: 'POST', body: form, headers: { origin: 'https://demo.example.com' } }))
}

/** Rows tied to these companies, all tables that grow with a sandbox. */
async function rowsOf(companyIds: string[]) {
  const [accounts, entries, lines, transactions, rules, integrations, stagedReceipts, receiptFiles] = await Promise.all([
    prisma.account.count({ where: { companyId: { in: companyIds } } }),
    prisma.accountingEntry.count({ where: { companyId: { in: companyIds } } }),
    prisma.entryLine.count({ where: { accountingEntry: { companyId: { in: companyIds } } } }),
    prisma.bankTransaction.count({ where: { bankAccount: { bankConnection: { companyId: { in: companyIds } } } } }),
    prisma.transactionRule.count({ where: { companyId: { in: companyIds } } }),
    prisma.integration.count({ where: { companyId: { in: companyIds } } }),
    prisma.stagedReceipt.count({ where: { companyId: { in: companyIds } } }),
    prisma.receiptFile.count({ where: { companyId: { in: companyIds } } }),
  ])
  return { accounts, entries, lines, transactions, rules, integrations, stagedReceipts, receiptFiles }
}

let a: Visitor
let b: Visitor

describe.skipIf(!available)('private demo sandboxes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('demo_sandbox')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('../sandbox/service')
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('"Entrer dans la démo" creates a private sandbox and signs the visitor in', async () => {
    const { enterDemo } = await import('../sandbox/actions')
    as(null)
    state.cookies.clear()
    const started = Date.now()
    const result = await enterDemo('/')
    const elapsed = Date.now() - started
    expect(result.ok).toBe(true)

    const user = await prisma.user.findFirstOrThrow({ where: { email: { endsWith: '@demo.kledg.com' } } })
    a = await visitor(user.id)
    expect(user).toMatchObject({ name: 'Visiteur', role: 'user', emailVerified: true })
    expect(a.email).toMatch(/^visiteur-[a-z0-9]{6}@demo\.kledg\.com$/)
    expect(result).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })
    expect(a.companies.map((c) => c.slug)).toEqual(
      ['atelier-lumen', 'lumen-holding', 'maison-verdier', 'sci-les-tilleuls'].map((s) => `${s}-${a.key}`),
    )
    // companyAdmin of its four companies, and of nothing else.
    const memberships = await prisma.member.findMany({ where: { userId: a.id }, select: { role: true } })
    expect(memberships.map((m) => m.role)).toEqual(['companyAdmin', 'companyAdmin', 'companyAdmin', 'companyAdmin'])
    // The director persona (default) is alone in its companies: no fictional directors.
    expect(await prisma.member.count({ where: { organization: { companyId: { in: a.companies.map((c) => c.id) } } } })).toBe(4)
    expect(await prisma.user.count({ where: { email: { endsWith: '@clients.demo.kledg.com' } } })).toBe(0)
    // The director persona starts in the simple mode (lib/demo/sandbox/service.ts personaDisplayMode).
    expect(await prisma.userPreference.findUnique({ where: { userId: a.id }, select: { displayMode: true } })).toEqual({ displayMode: 'simple' })

    // Signed in: Better Auth's session cookie was set on the response, for a session of this user.
    const sessionCookie = [...state.cookies.entries()].find(([name]) => name.endsWith('better-auth.session_token'))
    expect(sessionCookie).toBeDefined()
    expect(sessionCookie![1].options).toMatchObject({ httpOnly: true, path: '/' })
    const token = decodeURIComponent(sessionCookie![1].value).split('.')[0]
    expect(await prisma.session.findFirst({ where: { token, userId: a.id } })).not.toBeNull()

    // The books: 2025 closed, 2026 open, bank synced with the sandbox's own Qonto credentials.
    const years = await prisma.fiscalYear.findMany({ where: { companyId: a.companies[0].id }, orderBy: { year: 'asc' } })
    expect(years.map((y) => [y.year, y.isClosed])).toEqual([[2025, true], [2026, false]])
    const integration = await prisma.integration.findFirstOrThrow({ where: { companyId: a.companies[0].id } })
    const credentials = integration.credentials as { login: string; secretKey: string }
    expect(credentials.login).toBe(`demo-${a.key}`)
    expect(integration.credentialsEncrypted).toBe(true)
    const { demoQontoSecret } = await import('../qonto/credentials')
    expect(credentials.secretKey).not.toContain(demoQontoSecret(credentials.login)!)
    const rows = await rowsOf(a.companies.map((c) => c.id))
    expect(rows.transactions).toBeGreaterThan(300)
    expect(rows.rules).toBeGreaterThan(10)

    // Bank accounts: a readable name, never their slug, and 5121 (comptes en euros).
    const accounts = await prisma.bankAccount.findMany({
      where: { bankConnection: { companyId: { in: a.companies.map((c) => c.id) } } },
      select: { name: true, displayName: true, ledgerAccountCode: true },
    })
    expect(accounts).toHaveLength(4)
    for (const account of accounts) {
      expect(account).toMatchObject({ displayName: 'Compte principal Qonto', ledgerAccountCode: '5121' })
    }
    // Every option of the rules is explicit: recurring ones apply on refresh, variable ones are suggested.
    const rules = await prisma.transactionRule.findMany({
      where: { companyId: { in: a.companies.map((c) => c.id) } },
      select: { name: true, enabled: true, autoCreate: true, priority: true },
    })
    expect(rules.every((r) => r.enabled && r.priority > 0)).toBe(true)
    expect(rules.filter((r) => !r.autoCreate).map((r) => r.name).sort()).toEqual(
      ['Carburant du véhicule', 'Déplacements en train et VTC', 'Fournitures de bureau', 'Fournitures de bureau'],
    )
    // Reconciled entries are validated (sequential number) or drafts with a provisional number, never a draft with a sequential one.
    const drafts = await prisma.accountingEntry.findMany({
      where: { companyId: { in: a.companies.map((c) => c.id) }, status: 'draft' },
      select: { entryNumber: true },
    })
    for (const draft of drafts) expect(draft.entryNumber).not.toMatch(/^\d+$/)
    // A few seconds at most (local database).
    expect(elapsed).toBeLessThan(15_000)
  }, 60_000)

  it('sends a visitor already in a sandbox back to it instead of creating another', async () => {
    const { enterDemo } = await import('../sandbox/actions')
    as(a)
    expect(await enterDemo('/')).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })
    expect(await enterDemo('/consent?client_id=x')).toEqual({ ok: true, redirectTo: '/consent?client_id=x' })
    expect(await service.countSandboxes()).toBe(1)
  })

  it('creates two sandboxes at once, independent from each other', async () => {
    const [first, second] = await Promise.all([
      service.provisionSandbox({ ip: '198.51.100.2' }),
      service.provisionSandbox({ ip: '198.51.100.3' }),
    ])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.sandboxKey).not.toBe(second.sandboxKey)
    // Every company's 2025 balance sheet balances (checked by the seed before closing).
    expect([...first.unbalanced, ...second.unbalanced]).toEqual([])
    const [one, two] = await Promise.all([visitor(first.userId), visitor(second.userId)])
    expect(one.companies).toHaveLength(4)
    expect(two.companies).toHaveLength(4)
    const counts = await Promise.all([rowsOf(one.companies.map((c) => c.id)), rowsOf(two.companies.map((c) => c.id))])
    expect(counts[0]).toEqual(counts[1])
    b = one
    // The other one is not needed any more.
    await service.deleteSandboxes([{ id: two.id, email: two.email }])
    expect(await service.countSandboxes()).toBe(2)
  }, 60_000)

  it("keeps each visitor out of another sandbox's companies", async () => {
    as(a)
    const list = (await (await get(companiesRoute, '/api/companies')).json()) as Array<{ id: string }>
    expect(list.map((c) => c.id).sort()).toEqual(a.companies.map((c) => c.id).sort())

    for (const company of b.companies) {
      expect((await get(companyRoute, `/api/companies/${company.id}`, { id: company.id })).status).toBe(404)
      expect((await get(companyRoute, `/api/companies/${company.slug}`, { id: company.slug })).status).toBe(404)
    }
    expect((await get(companyRoute, `/api/companies/${a.companies[0].id}`, { id: a.companies[0].id })).status).toBe(200)
  })

  it('serves the sample files of the own companies only, whatever their slug', async () => {
    as(a)
    const mine = await get(samplesRoute, `/api/demo/samples?companyId=${a.companies[0].id}`)
    expect(mine.status).toBe(200)
    const json = (await mine.json()) as { files: Array<{ fileName: string }> }
    expect(json.files[0].fileName).toContain('atelier-lumen')
    expect((await get(samplesRoute, `/api/demo/samples?companyId=${b.companies[0].id}`)).status).toBe(404)
    expect((await get(samplesRoute, `/api/demo/samples?companyId=${b.companies[0].slug}`)).status).toBe(404)

    // The profile comes from the Qonto connection: renaming the slug keeps the samples.
    const holding = a.companies.find((c) => c.slug.startsWith('lumen-holding'))!
    await prisma.company.update({ where: { id: holding.id }, data: { slug: `ma-holding-${a.key}` } })
    const renamed = (await (await get(samplesRoute, `/api/demo/samples?companyId=${holding.id}`)).json()) as { files: Array<{ fileName: string }> }
    expect(renamed.files[0].fileName).toContain('lumen-holding')
    await prisma.company.update({ where: { id: holding.id }, data: { slug: holding.slug } })
  })

  it("refuses another sandbox's simulated Qonto credentials", async () => {
    const { handleDemoQontoRequest } = await import('../qonto/api')
    const { decrypt, integrationContext } = await import('@/lib/integrations/encryption')
    const { getEncryptionKey } = await import('@/lib/crypto/encryption-key')
    const credentialsOf = async (v: Visitor) => {
      const integration = await prisma.integration.findFirstOrThrow({ where: { companyId: v.companies[0].id } })
      const c = integration.credentials as { login: string; secretKey: string }
      return { login: c.login, secretKey: decrypt(c.secretKey, getEncryptionKey()!, integrationContext(v.companies[0].id, 'QONTO', 'secretKey')) }
    }
    const [mine, theirs] = await Promise.all([credentialsOf(a), credentialsOf(b)])
    const request = (authorization: string) =>
      handleDemoQontoRequest({ method: 'GET', path: ['organization'], searchParams: new URLSearchParams(), authorization, baseUrl: 'https://x' })
    expect(request(`${mine.login}:${mine.secretKey}`).status).toBe(200)
    expect(request(`${theirs.login}:${mine.secretKey}`).status).toBe(401)
    expect(request(`${mine.login}:${theirs.secretKey}`).status).toBe(401)
  })

  it('"Réinitialiser ma démo" rebuilds only this visitor\'s companies, same account and session', async () => {
    const { resetDemo } = await import('../sandbox/actions')
    const [atelier] = a.companies
    const ownBefore = await rowsOf(a.companies.map((c) => c.id))
    // What a visitor does: import a statement line, add a rule, grant an assistant access.
    const account = await prisma.bankAccount.findFirstOrThrow({ where: { bankConnection: { companyId: atelier.id } } })
    await prisma.bankTransaction.create({
      data: { bankAccountId: account.id, externalTransactionId: 'import-visitor-1', amount: '42.00', date: new Date('2026-09-30T00:00:00Z'), side: 'debit', label: 'Ligne importée', imported: true },
    })
    await prisma.transactionRule.create({ data: { companyId: atelier.id, name: 'Règle du visiteur', journalCode: 'BQ' } })
    // A receipt dropped on Justificatifs: its bytes in PostgreSQL, never in an object storage the demo does not have.
    const dropped = await dropReceipt(a, atelier.id, '2026-09-30 Boulangerie 42,00.jpg')
    expect(dropped.status, await dropped.clone().text()).toBe(201)
    const file = await prisma.receiptFile.findFirstOrThrow({ where: { companyId: atelier.id } })
    expect([file.storageDriver, file.storageKey, file.content?.length]).toEqual(['postgres', null, JPEG.length])
    // And one filed on a bank line (an attachment that keeps its receipt file).
    const filed = await prisma.receiptFile.create({
      data: { companyId: atelier.id, sha256: 'f'.repeat(64), contentType: 'image/jpeg', size: 4, content: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
    })
    const line = await prisma.bankTransaction.findFirstOrThrow({ where: { externalTransactionId: 'import-visitor-1' } })
    await prisma.attachment.create({ data: { companyId: atelier.id, fileName: 'ticket.jpg', receiptFileId: filed.id, bankTransactionId: line.id } })
    await prisma.apikey.create({ data: { id: 'key-a', referenceId: a.id, key: 'hashed-a', createdAt: new Date(), updatedAt: new Date() } })
    const grant = await prisma.aiAccessGrant.create({
      data: { userId: a.id, apiKeyId: 'key-a', allCompanies: false, companies: { create: [{ companyId: atelier.id }] } },
    })
    const sessionsBefore = await prisma.session.count({ where: { userId: a.id } })
    const otherBefore = await rowsOf(b.companies.map((c) => c.id))

    as(a)
    const result = await resetDemo()
    expect(result).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })

    const after = await visitor(a.id)
    expect(after.companies.map((c) => c.slug)).toEqual(a.companies.map((c) => c.slug))
    expect(after.companies.map((c) => c.id)).not.toContain(atelier.id)
    expect(await prisma.bankTransaction.count({ where: { externalTransactionId: 'import-visitor-1' } })).toBe(0)
    expect(await prisma.transactionRule.count({ where: { name: 'Règle du visiteur' } })).toBe(0)
    expect(await prisma.receiptFile.count({ where: { id: { in: [file.id, filed.id] } } })).toBe(0)
    expect(await prisma.aiAccessGrantCompany.count({ where: { grantId: grant.id } })).toBe(0)
    expect(await rowsOf(after.companies.map((c) => c.id))).toEqual(ownBefore)
    expect(await rowsOf(a.companies.map((c) => c.id))).toEqual({ accounts: 0, entries: 0, lines: 0, transactions: 0, rules: 0, integrations: 0, stagedReceipts: 0, receiptFiles: 0 })
    // Same account, still signed in, API key and assistant connection kept; the other sandbox is untouched.
    expect(await prisma.session.count({ where: { userId: a.id } })).toBe(sessionsBefore)
    expect(await prisma.aiAccessGrant.count({ where: { id: grant.id } })).toBe(1)
    expect(await rowsOf(b.companies.map((c) => c.id))).toEqual(otherBefore)
    a = after
  }, 60_000)

  it('refuses the reset to an account that is not a sandbox', async () => {
    const { resetDemo } = await import('../sandbox/actions')
    state.user = { id: 'admin', email: 'admin@example.com', name: 'Admin', role: 'admin' }
    expect(await resetDemo()).toMatchObject({ ok: false })
    as(null)
    expect(await resetDemo()).toMatchObject({ ok: false })
  })

  it('rate limits the creation per client IP', async () => {
    const limits = { ...service.sandboxLimits(), perIpPerHour: 2, maxSandboxes: 0 }
    // maxSandboxes 0 with every sandbox active: admitted requests are refused as "full", without seeding.
    expect(await service.provisionSandbox({ ip: '203.0.113.9', limits })).toEqual({ ok: false, reason: 'full' })
    expect(await service.provisionSandbox({ ip: '203.0.113.9', limits })).toEqual({ ok: false, reason: 'full' })
    expect(await service.provisionSandbox({ ip: '203.0.113.9', limits })).toEqual({ ok: false, reason: 'rate-limited' })
    // Another IP is not affected.
    expect(await service.provisionSandbox({ ip: '203.0.113.10', limits })).toEqual({ ok: false, reason: 'full' })

    // Through the action (5 per hour by default): the visitor gets a message.
    const { consumeRateLimit } = await import('@/lib/rate-limit')
    for (let i = 0; i < 2; i++) await consumeRateLimit('demo-sandbox|203.0.113.9', { window: 3600, max: 5 })
    const { enterDemo } = await import('../sandbox/actions')
    as(null)
    state.ip = '203.0.113.9'
    const refused = await enterDemo('/')
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toContain('Réessayez dans une heure')
    state.ip = '198.51.100.1'
  })

  it('at the cap, recycles the least recently active idle sandbox, else refuses with a friendly message', async () => {
    const live = await service.countSandboxes()
    const limits = { ...service.sandboxLimits(), maxSandboxes: live, evictIdleMinutes: 60 }
    // Everyone active: no room.
    expect(await service.provisionSandbox({ ip: '198.51.100.20', limits })).toEqual({ ok: false, reason: 'full' })

    // b idle for two hours, with a receipt dropped earlier: recycled for the newcomer.
    expect((await dropReceipt(b, b.companies[0].id, 'recycled.jpg')).status).toBe(201)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000)
    await prisma.user.update({ where: { id: b.id }, data: { updatedAt: twoHoursAgo } })
    await prisma.session.updateMany({ where: { userId: b.id }, data: { updatedAt: twoHoursAgo } })
    const newcomer = await service.provisionSandbox({ ip: '198.51.100.21', limits })
    expect(newcomer).toMatchObject({ ok: true, evicted: 1 })
    expect(await prisma.user.findUnique({ where: { id: b.id } })).toBeNull()
    expect(await rowsOf(b.companies.map((c) => c.id))).toEqual({ accounts: 0, entries: 0, lines: 0, transactions: 0, rules: 0, integrations: 0, stagedReceipts: 0, receiptFiles: 0 })
    expect(await service.countSandboxes()).toBe(live)
    if (newcomer.ok) b = await visitor(newcomer.userId)
  }, 60_000)

  it('the nightly cleanup deletes sandboxes inactive for 24 h with every row, and nothing else', async () => {
    // b: an API key, an assistant grant and a session, then a day and more of inactivity.
    await prisma.apikey.create({
      data: { id: 'key-b', referenceId: b.id, key: 'hashed', createdAt: new Date(), updatedAt: new Date() },
    })
    await prisma.aiAccessGrant.create({ data: { userId: b.id, apiKeyId: 'key-b' } })
    // A receipt dropped on Justificatifs, staged and not filed yet.
    expect((await dropReceipt(b, b.companies[0].id, 'ticket.jpg')).status).toBe(201)
    expect((await rowsOf(b.companies.map((c) => c.id))).stagedReceipts).toBe(1)
    await prisma.session.create({
      data: { id: 'session-b', token: 'token-b', userId: b.id, expiresAt: new Date(Date.now() + 86_400_000) },
    })
    const old = new Date(Date.now() - 25 * 3600_000)
    await prisma.$executeRaw`UPDATE "session" SET "updatedAt" = ${old} WHERE "userId" = ${b.id}`
    await prisma.$executeRaw`UPDATE "user" SET "updatedAt" = ${old} WHERE "id" = ${b.id}`
    // The shared account of the first demo version goes too.
    await prisma.user.create({ data: { id: 'legacy', email: 'demo@kledg.com', name: 'Compte démo', role: 'admin' } })

    const unauthorized = await get(cronRoute, '/api/cron/reset-demo')
    expect(unauthorized.status).toBe(401)
    const response = await get(cronRoute, '/api/cron/reset-demo', {}, { authorization: 'Bearer cron-secret-for-tests' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, deleted: 1, remaining: 0, legacyAccountRemoved: true, live: 1 })

    expect(await prisma.user.findUnique({ where: { id: b.id } })).toBeNull()
    expect(await prisma.session.count({ where: { userId: b.id } })).toBe(0)
    expect(await prisma.apikey.count({ where: { referenceId: b.id } })).toBe(0)
    expect(await prisma.aiAccessGrant.count({ where: { userId: b.id } })).toBe(0)
    expect(await prisma.member.count({ where: { userId: b.id } })).toBe(0)
    expect(await prisma.company.count({ where: { slug: { endsWith: `-${b.key}` } } })).toBe(0)
    expect(await rowsOf(b.companies.map((c) => c.id))).toEqual({ accounts: 0, entries: 0, lines: 0, transactions: 0, rules: 0, integrations: 0, stagedReceipts: 0, receiptFiles: 0 })
    expect(await prisma.user.findUnique({ where: { email: 'demo@kledg.com' } })).toBeNull()
    // Addresses of deleted companies go with them: only a's four remain.
    expect(await prisma.address.count()).toBe(4)

    // a is active: kept whole.
    expect((await visitor(a.id)).companies).toHaveLength(4)
  }, 60_000)
})
