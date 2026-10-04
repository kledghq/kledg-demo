/**
 * The Administrateur persona of the private demo sandboxes, against
 * PostgreSQL (lib/__tests__/helpers/test-db.ts). The visitor sees instance
 * pages of the demo's own (lib/demo/admin), but stays a plain user: Kledg's
 * administrator checks are untouched, so every instance route and Better
 * Auth admin endpoint answers 403, and nothing of another sandbox is ever
 * listed.
 *
 * Same mocks as sandbox.db.test.ts: the session (getCurrentUser) and
 * next/headers. Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('demo_admin_persona')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'https://demo.example.com'
  process.env.KLEDG_DEMO_MODE = 'true'
  process.env.QONTO_API_URL = 'https://demo.example.com/api/demo/qonto/v2'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return {
    user: null as null | { id: string; email: string; name: string | null; role: string | null },
    cookies: new Map<string, { value: string; options: Record<string, unknown> }>(),
  }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest' }),
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => state.cookies.set(name, { value, options }),
  }),
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma

interface Visitor {
  id: string
  email: string
  cookie: string
  companies: string[]
}

const ORIGIN = 'https://demo.example.com'

/** Enters the demo as a new visitor in `persona`, keeping the session cookie Better Auth set. */
async function enter(persona: 'director' | 'accountant' | 'admin'): Promise<Visitor> {
  const { enterDemo } = await import('../sandbox/actions')
  state.user = null
  state.cookies.clear()
  const result = await enterDemo('/', persona)
  expect(result.ok).toBe(true)
  const cookie = [...state.cookies.entries()].map(([name, { value }]) => `${name}=${value}`).join('; ')
  const user = await prisma.user.findFirstOrThrow({ where: { email: { endsWith: '@demo.kledg.com' } }, orderBy: { createdAt: 'desc' } })
  const companies = await prisma.company.findMany({ where: { organization: { members: { some: { userId: user.id } } } }, select: { id: true } })
  return { id: user.id, email: user.email, cookie, companies: companies.map((c) => c.id) }
}

function as(v: Visitor) {
  state.user = { id: v.id, email: v.email, name: 'Visiteur', role: 'user' }
}

async function call(route: () => Promise<unknown>, method: string, path: string, params: Record<string, string> = {}, body?: unknown) {
  const handler = ((await route()) as Record<string, Handler>)[method]
  const request = new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve(params) })
}

async function betterAuthAdmin(path: string, cookie: string, body: unknown) {
  const { auth } = await import('@/lib/auth')
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/admin/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    }),
  )
}

let admin: Visitor
let other: Visitor

describe.skipIf(!available)('Administrateur persona of the demo sandboxes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('demo_admin_persona')
    ;({ prisma } = await import('@/lib/prisma'))
    other = await enter('director')
    admin = await enter('admin')
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('is a plain user, companyAdmin of its four companies next to their managers, with the demo instance pages', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    expect(user.role).toBe('user')
    const { isGlobalAdmin } = await import('@/lib/rbac/authorize')
    expect(isGlobalAdmin({ ...user, role: user.role ?? null })).toBe(false)

    const members = await prisma.member.findMany({
      where: { organization: { companyId: { in: admin.companies } } },
      select: { userId: true, role: true, user: { select: { email: true, banned: true } } },
    })
    expect(members.filter((m) => m.userId === admin.id).map((m) => m.role)).toEqual(Array(4).fill('companyAdmin'))
    const managers = members.filter((m) => m.userId !== admin.id)
    expect(managers.length).toBe(4)
    expect(managers.every((m) => m.role === 'companyAdmin' && m.user.banned && m.user.email.endsWith('@clients.demo.kledg.com'))).toBe(true)

    const { sandboxPersona } = await import('../sandbox/membership')
    expect(await sandboxPersona(admin.id)).toBe('admin')
    expect(await sandboxPersona(other.id)).toBe('director')
    const { demoInstanceLinks } = await import('../admin/links')
    expect(await demoInstanceLinks({ ...admin, role: 'user' })).toEqual({ instance: '/demo/instance', users: '/demo/users', updates: '/demo/updates' })
    expect(await demoInstanceLinks({ ...other, role: 'user' })).toBeNull()
    // The settings sidebar slot.
    const { instanceSettingsLinks } = await import('@/components/instance/slots')
    expect(await instanceSettingsLinks({ ...admin, role: 'user' })).not.toBeNull()
    expect(await instanceSettingsLinks({ ...other, role: 'user' })).toBeNull()
  })

  it("lists only its own sandbox's users and companies", async () => {
    const { listSandboxUsers } = await import('../admin/instance.service')
    const users = await listSandboxUsers(admin)
    expect(users[0]).toMatchObject({ id: admin.id, isSelf: true })
    expect(users.map((u) => u.name).slice(1).sort()).toEqual(['Claire Vasseur', 'Hélène Garnier', 'Thomas Verdier'])
    expect(users.some((u) => u.id === other.id)).toBe(false)

    as(admin)
    const response = await call(() => import('@/app/api/companies/route'), 'GET', '/api/companies')
    expect(response.status).toBe(200)
    const ids = ((await response.json()) as Array<{ id: string }>).map((c) => c.id).sort()
    expect(ids).toEqual([...admin.companies].sort())
  })

  it('gets 403 on every instance route and Better Auth admin endpoint', async () => {
    as(admin)
    const users = () => import('@/app/api/users/route')
    const user = () => import('@/app/api/users/[id]/route')
    const refused: Array<[string, Response]> = [
      ['list users', await call(users, 'GET', '/api/users')],
      ['create user', await call(users, 'POST', '/api/users', {}, { email: 'backdoor@example.com', name: 'x', role: 'admin', password: 'pwned-password-123' })],
      ['ban user', await call(user, 'PATCH', `/api/users/${other.id}`, { id: other.id }, { banned: true })],
      ['delete user', await call(user, 'DELETE', `/api/users/${other.id}`, { id: other.id })],
      ['updates', await call(() => import('@/app/api/updates/route'), 'GET', '/api/updates')],
      ['updates version', await call(() => import('@/app/api/updates/version/route'), 'GET', '/api/updates/version')],
      ['updates install', await call(() => import('@/app/api/updates/install/route'), 'POST', '/api/updates/install', {}, { version: '9.9.9' })],
      ['updates token', await call(() => import('@/app/api/updates/connection/route'), 'POST', '/api/updates/connection', {}, { token: 'ghp_x' })],
      ['impersonate', await betterAuthAdmin('impersonate-user', admin.cookie, { userId: other.id })],
      ['ban (Better Auth)', await betterAuthAdmin('ban-user', admin.cookie, { userId: other.id })],
      ['create user (Better Auth)', await betterAuthAdmin('create-user', admin.cookie, { email: 'backdoor@example.com', password: 'pwned-password-123', name: 'x', role: 'admin' })],
      ['set role (Better Auth)', await betterAuthAdmin('set-role', admin.cookie, { userId: admin.id, role: 'admin' })],
    ]
    for (const [label, response] of refused) expect(response.status, label).toBe(403)

    expect(await prisma.user.count({ where: { email: 'backdoor@example.com' } })).toBe(0)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).banned).toBeFalsy()
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('user')
    expect(await prisma.session.count({ where: { impersonatedBy: { not: null } } })).toBe(0)
  })

  it('the demo policy refuses every instance action, for this persona too', async () => {
    const { isActionAllowed } = await import('@/lib/instance')
    const actor = { id: admin.id, email: admin.email, role: 'user' }
    for (const action of ['manage-users', 'manage-updates', 'setup', 'onboarding', 'invite-member', 'delete-company'] as const) {
      expect(await isActionAllowed(action, actor), action).toBe(false)
    }
  })
})
