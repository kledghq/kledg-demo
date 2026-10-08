/**
 * Member removal on the demo (lib/demo/policy.ts refuses 'remove-member'),
 * against PostgreSQL through Kledg's routes and MCP server (session mocked):
 * - the Membres page data: every "Retirer" and "Quitter" comes disabled,
 *   with the demo's reason, even for the company administrator;
 * - DELETE /api/companies/[id]/members/[memberId] and
 *   DELETE /api/companies/[id]/membership answer 403 with that message;
 * - manage_members action remove is refused at the dry run, before any
 *   approval is asked;
 * - outside demo mode, Kledg's rules apply again (the administrator removes
 *   a viewer).
 * Skipped when the test database server is unreachable.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('demo_member_removal')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'https://demo.example.com'
  process.env.NEXT_PUBLIC_APP_URL = 'https://demo.example.com'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const REFUSAL = "Le retrait de membres est désactivé sur l'instance de démonstration."

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

const OWNER = { id: 'u-owner', email: 'visiteur-abc123@demo.kledg.com', name: 'Visiteur', role: 'user' }
const VIEWER = { id: 'u-viewer', email: 'viewer-abc123@clients.demo.kledg.com', name: 'Marc Vasseur', role: 'user' }
const COMPANY = 'c-demo'

let prisma: typeof import('@/lib/prisma').prisma

function as(user: typeof OWNER) {
  state.user = { ...user }
}

async function route(path: string, method: 'GET' | 'DELETE', handler: () => Promise<unknown>, params: Record<string, string>) {
  const handlers = (await handler()) as Record<string, Handler>
  return handlers[method](new NextRequest(`https://demo.example.com${path}`, { method, headers: { origin: 'https://demo.example.com' } }), { params: Promise.resolve(params) })
}

const members = () => route(`/api/companies/${COMPANY}/members`, 'GET', () => import('@/app/api/companies/[id]/members/route'), { id: COMPANY })
const removeViewer = () =>
  route(`/api/companies/${COMPANY}/members/m-viewer`, 'DELETE', () => import('@/app/api/companies/[id]/members/[memberId]/route'), { id: COMPANY, memberId: 'm-viewer' })
const leave = () => route(`/api/companies/${COMPANY}/membership`, 'DELETE', () => import('@/app/api/companies/[id]/membership/route'), { id: COMPANY })

async function mcpCall(key: string, name: string, args: Record<string, unknown>) {
  const { POST } = (await import('@/app/api/mcp/route')) as unknown as { POST: (request: Request) => Promise<Response> }
  const response = await POST(
    new Request('https://demo.example.com/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  )
  const text = await response.text()
  const raw = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  const body = JSON.parse(raw) as { result?: { content?: Array<{ text: string }>; isError?: boolean }; error?: { message: string } }
  return { ok: !body.result?.isError && !body.error, text: body.result?.content?.[0]?.text ?? body.error?.message ?? '' }
}

describe.skipIf(!available)('member removal on the demo instance', () => {
  beforeAll(async () => {
    ;({ prisma } = await import('@/lib/prisma'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('demo_member_removal')
    for (const user of [OWNER, VIEWER]) await prisma.user.create({ data: { ...user } })
    await prisma.company.create({ data: { id: COMPANY, name: 'Atelier Lumen', slug: 'atelier-lumen-abc123', siren: '123456782', legalType: 'SAS', closingDay: 31, closingMonth: 12 } })
    await prisma.organization.create({ data: { id: 'org-demo', name: 'Atelier Lumen', slug: 'org-demo', createdAt: new Date(), companyId: COMPANY } })
    await prisma.member.create({ data: { id: 'm-owner', userId: OWNER.id, organizationId: 'org-demo', role: 'companyAdmin', createdAt: new Date('2026-01-01') } })
    await prisma.member.create({ data: { id: 'm-viewer', userId: VIEWER.id, organizationId: 'org-demo', role: 'viewer', createdAt: new Date('2026-01-02') } })
    vi.stubEnv('KLEDG_DEMO_MODE', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('the Membres page gets every "Retirer" and "Quitter" disabled with the demo reason, even for the company administrator', async () => {
    as(OWNER)
    const response = await members()
    expect(response.status).toBe(200)
    const list = (await response.json()) as Array<{ id: string; self: boolean; removal: { allowed: boolean; reason?: string } }>
    expect(list.map((m) => [m.id, m.self, m.removal.allowed])).toEqual([
      ['m-owner', true, false],
      ['m-viewer', false, false],
    ])
    for (const m of list) {
      expect(m.removal.reason).toContain(REFUSAL)
      expect(m.removal.reason).toContain('https://www.kledg.com')
    }
  })

  it('refuses the removal and leaving routes with 403 and keeps every membership', async () => {
    as(OWNER)
    const removed = await removeViewer()
    expect(removed.status).toBe(403)
    expect(((await removed.json()) as { error: string }).error).toContain(REFUSAL)
    as(VIEWER)
    const left = await leave()
    expect(left.status).toBe(403)
    expect(((await left.json()) as { error: string }).error).toContain(REFUSAL)
    expect(await prisma.member.count({ where: { organizationId: 'org-demo' } })).toBe(2)
    expect(await prisma.auditLog.count({ where: { action: 'MEMBER_REMOVED' } })).toBe(0)
  })

  it('refuses manage_members action remove at the dry run, before asking for an approval', async () => {
    const { createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service')
    const { key } = await createApiKeyWithGrant({ ...OWNER }, 'Assistant', { allCompanies: true, companyIds: [] }, 'admin', 'validation')
    const result = await mcpCall(key, 'manage_members', { companyId: COMPANY, action: 'remove', memberId: 'm-viewer' })
    expect(result.ok).toBe(false)
    expect(result.text).toContain(REFUSAL)
    expect(await prisma.mcpPendingAction.count()).toBe(0)
    expect(await prisma.member.count({ where: { id: 'm-viewer' } })).toBe(1)
  })

  it("outside demo mode, Kledg's rules apply: the administrator removes the viewer", async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'false')
    as(OWNER)
    const list = (await (await members()).json()) as Array<{ id: string; removal: { allowed: boolean } }>
    expect(list.find((m) => m.id === 'm-viewer')?.removal).toEqual({ allowed: true })
    expect((await removeViewer()).status).toBe(200)
    expect(await prisma.member.count({ where: { id: 'm-viewer' } })).toBe(0)
  })
})
