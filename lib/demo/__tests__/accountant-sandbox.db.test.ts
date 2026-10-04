/**
 * The accountant persona of the private demo sandboxes, against PostgreSQL
 * (lib/__tests__/helpers/test-db.ts):
 * - "Entrer dans la démo" as expert-comptable: the visitor is `accountant`
 *   of the four companies, each with its fictional director (companyAdmin,
 *   no credentials, banned) who can never sign in;
 * - the books give the accountant work and stay balanced: drafts in the
 *   last booked month, Lumen Holding's 2025 left open;
 * - what the role allows (validate entries, reconcile, close the year) and
 *   refuses (bank connections, company settings, members), through Kledg's
 *   own routes;
 * - persona switch (banner and login card), reset keeping the persona;
 * - isolation from another sandbox, and the cleanup removing the fictional
 *   directors with their sandbox (and those left behind).
 *
 * Same mocks as sandbox.db.test.ts: the session (getCurrentUser) and
 * next/headers. Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('demo_accountant')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'https://demo.example.com'
  process.env.KLEDG_DEMO_MODE = 'true'
  process.env.QONTO_API_URL = 'https://demo.example.com/api/demo/qonto/v2'
  process.env.CRON_SECRET = 'cron-secret-for-tests'
  delete process.env.RATE_LIMIT_DISABLED
  return {
    user: null as null | { id: string; email: string; name: string | null; role: string | null },
    cookies: new Map<string, { value: string; options: Record<string, unknown> }>(),
    ip: '198.51.100.31',
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
import { directorSandboxKeyOf, DIRECTOR_EMAIL_DOMAIN } from '../sandbox/persona'

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
  companies: Array<{ id: string; slug: string; name: string }>
}

async function visitor(userId: string): Promise<Visitor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const companies = await prisma.company.findMany({
    where: { organization: { members: { some: { userId } } } },
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  })
  return { id: user.id, email: user.email, key: user.email.slice('visiteur-'.length, 'visiteur-'.length + 6), companies }
}

function as(v: Visitor | null) {
  state.user = v ? { id: v.id, email: v.email, name: 'Visiteur', role: 'user' } : null
}

function company(v: Visitor, prefix: string) {
  return v.companies.find((c) => c.slug.startsWith(prefix))!
}

async function call(
  route: () => Promise<unknown>,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  params: Record<string, string> = {},
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const handler = ((await route()) as Record<string, Handler>)[method]
  const request = new NextRequest(`https://demo.example.com${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: 'https://demo.example.com', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve(params) })
}

const companiesRoute = () => import('@/app/api/companies/route')
const companyRoute = () => import('@/app/api/companies/[id]/route')
const membersRoute = () => import('@/app/api/companies/[id]/members/route')
const bulkValidateRoute = () => import('@/app/api/entries/bulk-validate/route')
const reconcileRoute = () => import('@/app/api/transactions/[id]/reconcile/route')
const closeRoute = () => import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/close/route')
const qontoConnectRoute = () => import('@/app/api/qonto/connect/route')
const connectionRoute = () => import('@/app/api/banking/connections/[id]/route')
const cronRoute = () => import('@/app/api/cron/reset-demo/route')

/** Members of the visitor's companies: roles of the visitor and the directors. */
async function membersOf(v: Visitor) {
  return prisma.member.findMany({
    where: { organization: { companyId: { in: v.companies.map((c) => c.id) } } },
    select: { role: true, userId: true, organization: { select: { companyId: true } }, user: { select: { email: true, name: true, banned: true } } },
  })
}

async function directorsOf(key: string) {
  return prisma.user.findMany({ where: { email: { endsWith: `-${key}@${DIRECTOR_EMAIL_DOMAIN}` } }, orderBy: { email: 'asc' } })
}

/** Entries whose debits and credits differ (cents), for these companies. */
async function unbalancedEntries(companyIds: string[]): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM (
      SELECT e."id" FROM "accounting_entries" e JOIN "entry_lines" l ON l."accountingEntryId" = e."id"
      WHERE e."companyId" = ANY(${companyIds}::text[])
      GROUP BY e."id" HAVING SUM(l."debit") <> SUM(l."credit")
    ) t
  `
  return Number(rows[0].count)
}

async function drafts(companyId: string) {
  return prisma.accountingEntry.findMany({ where: { companyId, status: 'draft' }, select: { id: true, entryNumber: true, date: true } })
}

async function fiscalYears(companyId: string) {
  return (await prisma.fiscalYear.findMany({ where: { companyId }, orderBy: { year: 'asc' } })).map((y) => [y.year, y.isClosed])
}

let a: Visitor

describe.skipIf(!available)('accountant persona of the demo sandboxes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('demo_accountant')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('../sandbox/service')
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('"Entrer dans la démo" as expert-comptable: accountant of four client companies, each with its fictional director', async () => {
    const { enterDemo } = await import('../sandbox/actions')
    as(null)
    state.cookies.clear()
    const result = await enterDemo('/', 'accountant')
    expect(result.ok).toBe(true)

    const user = await prisma.user.findFirstOrThrow({ where: { email: { endsWith: '@demo.kledg.com' } } })
    a = await visitor(user.id)
    expect(result).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })
    expect(a.companies).toHaveLength(4)
    // Directors are not sandboxes: one visitor counted.
    expect(await service.countSandboxes()).toBe(1)
    expect(await service.sandboxPersona(a.id)).toBe('accountant')

    const members = await membersOf(a)
    const visitorRoles = members.filter((m) => m.userId === a.id).map((m) => m.role)
    expect(visitorRoles).toEqual(['accountant', 'accountant', 'accountant', 'accountant'])
    // One companyAdmin per company, a fictional director of this sandbox.
    for (const c of a.companies) {
      const admins = members.filter((m) => m.organization.companyId === c.id && m.role === 'companyAdmin')
      expect(admins).toHaveLength(1)
      expect(directorSandboxKeyOf(admins[0].user.email)).toBe(a.key)
      expect(admins[0].user.banned).toBe(true)
    }
    const directorOf = (prefix: string) =>
      members.find((m) => m.organization.companyId === company(a, prefix).id && m.role === 'companyAdmin')!.user.name
    expect(directorOf('atelier-lumen')).toBe('Claire Vasseur')
    expect(directorOf('lumen-holding')).toBe('Claire Vasseur')
    expect(directorOf('maison-verdier')).toBe('Thomas Verdier')
    expect(directorOf('sci-les-tilleuls')).toBe('Hélène Garnier')

    // Three people, none with credentials: nobody can sign in as them.
    const directors = await directorsOf(a.key)
    expect(directors.map((d) => d.email)).toEqual(
      ['claire.vasseur', 'helene.garnier', 'thomas.verdier'].map((login) => `${login}-${a.key}@${DIRECTOR_EMAIL_DOMAIN}`),
    )
    expect(await prisma.authAccount.count({ where: { userId: { in: directors.map((d) => d.id) } } })).toBe(0)
    const { auth } = await import('@/lib/auth')
    for (const password of ['', 'demo', 'password123']) {
      const signIn = await auth.api.signInEmail({ body: { email: directors[0].email, password } }).catch((e: unknown) => e)
      expect(signIn).toBeInstanceOf(Error)
    }
  }, 60_000)

  it('gives the accountant work and keeps the books balanced', async () => {
    const atelier = company(a, 'atelier-lumen')
    const holding = company(a, 'lumen-holding')
    // Lumen Holding's 2025 is left to close; the others are closed.
    expect(await fiscalYears(holding.id)).toEqual([[2025, false], [2026, false]])
    for (const c of a.companies.filter((c) => c.id !== holding.id)) expect(await fiscalYears(c.id)).toEqual([[2025, true], [2026, false]])

    // Drafts of the second half of the last booked month, with provisional numbers.
    const { demoLedgerCutoff, demoDraftsFrom } = await import('../seed')
    const from = demoDraftsFrom(demoLedgerCutoff(new Date()))
    const atelierDrafts = await drafts(atelier.id)
    expect(atelierDrafts.length).toBeGreaterThan(5)
    for (const d of atelierDrafts) {
      expect(d.date.toISOString().slice(0, 10) >= from).toBe(true)
      expect(d.entryNumber).toMatch(/^[A-Z]/)
    }
    // Validated entries keep a gapless sequence per fiscal year.
    const fy2026 = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: atelier.id, year: 2026 } })
    const numbers = (
      await prisma.accountingEntry.findMany({ where: { fiscalYearId: fy2026.id, status: 'validated' }, select: { entryNumber: true } })
    )
      .map((e) => Number(e.entryNumber))
      .sort((x, y) => x - y)
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))

    // Every entry balances; transactions after the cutoff wait for reconciliation.
    expect(await unbalancedEntries(a.companies.map((c) => c.id))).toBe(0)
    const unreconciled = await prisma.bankTransaction.count({
      where: { reconciled: false, bankAccount: { bankConnection: { companyId: { in: a.companies.map((c) => c.id) } } } },
    })
    expect(unreconciled).toBeGreaterThan(10)
  })

  it('lets the accountant validate entries, reconcile transactions and close the year', async () => {
    as(a)
    const atelier = company(a, 'atelier-lumen')
    const holding = company(a, 'lumen-holding')

    // Validate the drafts: definitive numbers, next in sequence.
    const before = await drafts(atelier.id)
    const validated = await call(bulkValidateRoute, 'POST', '/api/entries/bulk-validate', {}, {
      companyId: atelier.id,
      entryIds: before.map((d) => d.id),
      status: 'validated',
    })
    expect(validated.status).toBe(200)
    expect(await validated.json()).toMatchObject({ validated: before.length, failed: 0 })
    expect(await drafts(atelier.id)).toHaveLength(0)

    // Reconcile a bank transaction with a new entry (counterpart on the suspense account 471).
    const transaction = await prisma.bankTransaction.findFirstOrThrow({
      where: { reconciled: false, bankAccount: { bankConnection: { companyId: atelier.id } } },
      orderBy: { date: 'desc' },
    })
    const fiscalYear = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: atelier.id, year: transaction.date.getUTCFullYear() } })
    const suspense = await prisma.account.findFirstOrThrow({ where: { companyId: atelier.id, fiscalYearId: fiscalYear.id, code: '471' } })
    const journal = await prisma.journal.findFirstOrThrow({ where: { companyId: atelier.id, code: 'BQ' } })
    const amount = transaction.amount.abs().toFixed(2)
    const outgoing = transaction.side === 'debit'
    const reconciled = await call(reconcileRoute, 'POST', `/api/transactions/${transaction.id}/reconcile`, { id: transaction.id }, {
      journalId: journal.id,
      date: transaction.date.toISOString().slice(0, 10),
      description: 'Opération à identifier',
      lines: [{ accountId: suspense.id, debit: outgoing ? amount : '0', credit: outgoing ? '0' : amount }],
    })
    expect(reconciled.status).toBe(201)
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).reconciled).toBe(true)

    // Close Lumen Holding's 2025: closing entry, opening entries in 2026, year locked.
    const fy2025 = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: holding.id, year: 2025 } })
    const closed = await call(closeRoute, 'POST', `/api/companies/${holding.id}/fiscal-years/${fy2025.id}/close`, {
      id: holding.id,
      fiscalYearId: fy2025.id,
    })
    expect(closed.status).toBe(200)
    expect(await fiscalYears(holding.id)).toEqual([[2025, true], [2026, false]])
    expect(await unbalancedEntries([holding.id])).toBe(0)
  }, 60_000)

  it('refuses bank connections, company settings and members to the accountant (403 naming the role)', async () => {
    as(a)
    const atelier = company(a, 'atelier-lumen')
    const refused = async (response: Response) => {
      expect(response.status).toBe(403)
      return ((await response.json()) as { error: string }).error
    }

    expect(
      await refused(
        await call(qontoConnectRoute, 'POST', '/api/qonto/connect', {}, { companyId: atelier.id, login: 'demo-x', secretKey: 'secret' }),
      ),
    ).toContain('Comptable')
    const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: atelier.id } })
    expect(await refused(await call(connectionRoute, 'DELETE', `/api/banking/connections/${connection.id}`, { id: connection.id }))).toContain(
      'Comptable',
    )
    expect(await refused(await call(companyRoute, 'PATCH', `/api/companies/${atelier.id}`, { id: atelier.id }, { name: 'Autre nom' }))).toContain(
      'Comptable',
    )
    await refused(
      await call(membersRoute, 'POST', `/api/companies/${atelier.id}/members`, { id: atelier.id }, { email: 'x@example.com', role: 'viewer' }),
    )
    // Nothing changed; reading stays allowed (members list shows the director).
    expect(await prisma.bankConnection.count({ where: { id: connection.id } })).toBe(1)
    expect((await prisma.company.findUniqueOrThrow({ where: { id: atelier.id } })).name).toBe('Atelier Lumen')
    const list = await call(membersRoute, 'GET', `/api/companies/${atelier.id}/members`, { id: atelier.id })
    expect(list.status).toBe(200)
    const roles = ((await list.json()) as Array<{ name: string; roles: string[] }>).map((m) => [m.name, m.roles])
    expect(roles).toEqual(expect.arrayContaining([['Claire Vasseur', ['companyAdmin']], ['Visiteur', ['accountant']]]))
  })

  it('keeps the persona on "Réinitialiser ma démo", with new directors and fresh work', async () => {
    const { resetDemo } = await import('../sandbox/actions')
    const directorsBefore = await directorsOf(a.key)
    as(a)
    const result = await resetDemo()
    expect(result).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })

    const after = await visitor(a.id)
    expect(await service.sandboxPersona(a.id)).toBe('accountant')
    expect(after.companies.map((c) => c.slug)).toEqual(a.companies.map((c) => c.slug))
    const directorsAfter = await directorsOf(a.key)
    expect(directorsAfter.map((d) => d.email)).toEqual(directorsBefore.map((d) => d.email))
    expect(directorsAfter.map((d) => d.id)).not.toContain(directorsBefore[0].id)
    expect((await drafts(company(after, 'atelier-lumen').id)).length).toBeGreaterThan(5)
    expect(await fiscalYears(company(after, 'lumen-holding').id)).toEqual([[2025, false], [2026, false]])
    a = after
  }, 60_000)

  it('switches persona from the banner and from the login card, same account and session', async () => {
    const { switchDemoPersona, enterDemo } = await import('../sandbox/actions')
    const sessions = await prisma.session.count({ where: { userId: a.id } })
    as(a)

    // "Essayer en tant que dirigeant": companyAdmin of the four companies, no director left, books as the director persona.
    expect(await switchDemoPersona('director')).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })
    a = await visitor(a.id)
    expect(await service.sandboxPersona(a.id)).toBe('director')
    expect((await membersOf(a)).map((m) => [m.userId === a.id, m.role])).toEqual(Array(4).fill([true, 'companyAdmin']))
    expect(await directorsOf(a.key)).toHaveLength(0)
    for (const c of a.companies) {
      expect(await fiscalYears(c.id)).toEqual([[2025, true], [2026, false]])
      expect(await drafts(c.id)).toHaveLength(0)
    }
    // The director may edit the company, which the accountant could not.
    const atelier = company(a, 'atelier-lumen')
    const renamed = await call(companyRoute, 'PATCH', `/api/companies/${atelier.id}`, { id: atelier.id }, { name: 'Atelier Lumen' })
    expect(renamed.status).toBe(200)

    // The login card: same persona goes back, the other one recreates the sandbox.
    expect(await enterDemo('/', 'director')).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })
    expect(await service.sandboxPersona(a.id)).toBe('director')
    expect(await enterDemo('/', 'accountant')).toEqual({ ok: true, redirectTo: `/atelier-lumen-${a.key}` })
    a = await visitor(a.id)
    expect(await service.sandboxPersona(a.id)).toBe('accountant')
    expect(await directorsOf(a.key)).toHaveLength(3)
    expect(await prisma.session.count({ where: { userId: a.id } })).toBe(sessions)
    expect(await service.countSandboxes()).toBe(1)

    // An unknown persona from a crafted request is refused.
    expect(await switchDemoPersona('superadmin' as never)).toMatchObject({ ok: false })
    expect(await enterDemo('/', 'owner' as never)).toMatchObject({ ok: false })
  }, 120_000)

  it("keeps an accountant out of another sandbox's companies, and the other sandbox's directors out of its own", async () => {
    const other = await service.provisionSandbox({ ip: '198.51.100.32', persona: 'accountant' })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    expect(other.unbalanced).toEqual([])
    const b = await visitor(other.userId)
    as(a)
    const list = (await (await call(companiesRoute, 'GET', '/api/companies')).json()) as Array<{ id: string }>
    expect(list.map((c) => c.id).sort()).toEqual(a.companies.map((c) => c.id).sort())
    for (const c of b.companies) {
      expect((await call(companyRoute, 'GET', `/api/companies/${c.id}`, { id: c.id })).status).toBe(404)
      expect((await call(membersRoute, 'GET', `/api/companies/${c.id}/members`, { id: c.id })).status).toBe(404)
    }
    // Each sandbox's directors are members of its own companies only.
    const keysOf = async (v: Visitor) =>
      new Set(
        (await membersOf(v)).filter((m) => m.userId !== v.id).map((m) => directorSandboxKeyOf(m.user.email)),
      )
    expect(await keysOf(a)).toEqual(new Set([a.key]))
    expect(await keysOf(b)).toEqual(new Set([b.key]))

    // Deleting b takes its directors, not a's.
    await service.deleteSandboxes([{ id: b.id, email: b.email }])
    expect(await directorsOf(b.key)).toHaveLength(0)
    expect(await prisma.company.count({ where: { id: { in: b.companies.map((c) => c.id) } } })).toBe(0)
    expect(await directorsOf(a.key)).toHaveLength(3)
    expect(await service.countSandboxes()).toBe(1)
  }, 60_000)

  it('the nightly cleanup removes the fictional directors with their sandbox, and directors left behind', async () => {
    // A director whose visitor is gone (a deletion cut short), alone in a company.
    const ghostKey = 'zz9zz9'
    const ghost = await prisma.user.create({
      data: {
        id: 'ghost-director',
        email: `claire.vasseur-${ghostKey}@${DIRECTOR_EMAIL_DOMAIN}`,
        name: 'Claire Vasseur',
        banned: true,
        createdAt: new Date(Date.now() - 2 * 3600_000),
      },
    })
    const ghostCompany = await prisma.company.create({ data: { name: 'Société fantôme', slug: `fantome-${ghostKey}`, siren: '999999999' } })
    const { ensureCompanyOrganization } = await import('@/lib/rbac/ensure-company-organization.service')
    const organization = await ensureCompanyOrganization(ghostCompany.id)
    await prisma.member.create({ data: { id: 'ghost-member', organizationId: organization.id, userId: ghost.id, role: 'companyAdmin', createdAt: new Date() } })

    // a: inactive for a day and more.
    const old = new Date(Date.now() - 25 * 3600_000)
    await prisma.$executeRaw`UPDATE "session" SET "updatedAt" = ${old} WHERE "userId" = ${a.id}`
    await prisma.$executeRaw`UPDATE "user" SET "updatedAt" = ${old} WHERE "id" = ${a.id}`

    const response = await call(cronRoute, 'GET', '/api/cron/reset-demo', {}, undefined, { authorization: 'Bearer cron-secret-for-tests' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, deleted: 1, remaining: 0, orphanDirectors: 1, live: 0 })

    expect(await prisma.user.count({ where: { email: { endsWith: `@${DIRECTOR_EMAIL_DOMAIN}` } } })).toBe(0)
    expect(await prisma.user.findUnique({ where: { id: a.id } })).toBeNull()
    expect(await prisma.company.count()).toBe(0)
    expect(await prisma.member.count()).toBe(0)
  }, 60_000)
})
