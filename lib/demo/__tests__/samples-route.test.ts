/**
 * Demo sample routes against PostgreSQL (lib/__tests__/helpers/test-db.ts):
 * demo-mode gate, company scoping, deterministic files, and the import of a
 * sample showing both new lines and probable duplicates.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('demo_samples')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { profileBySlug } from '@/lib/demo/qonto/profiles'
import { addDays, toDateKey } from '@/lib/demo/qonto/engine'
import { sampleLines } from '@/lib/demo/samples'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let LIST: Handler
let FILE: Handler
let IMPORT: Handler

const USERS = {
  member: { id: 'u-member', email: 'member@test.local', name: 'Member', role: 'user' },
  outsider: { id: 'u-outsider', email: 'outsider@test.local', name: 'Outsider', role: 'user' },
} as const

const profile = profileBySlug('atelier-lumen')
const ids = {} as Record<string, string>

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name ?? '', role: user.role } })
  }
  for (const [prefix, slug] of [
    ['a', 'atelier-lumen'],
    ['b', 'bureau-beta'],
  ] as const) {
    const company = await prisma.company.create({ data: { name: slug, slug, siren: prefix === 'a' ? '111111111' : '222222222' } })
    await prisma.organization.create({ data: { id: `org-${prefix}`, name: slug, slug: `org-${slug}`, createdAt: new Date(), companyId: company.id } })
    const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: 'demo', secretKeyEncrypted: 'x' } })
    const iban = prefix === 'a' ? profile.bankAccount.iban : 'FR7612345000010000000000123'
    const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: iban, iban, name: 'Compte principal' } })
    ids[`${prefix}Company`] = company.id
    ids[`${prefix}Account`] = account.id
  }
  await prisma.member.create({ data: { id: 'm-a', userId: 'u-member', organizationId: 'org-a', role: 'accountant', createdAt: new Date() } })
  await prisma.member.create({ data: { id: 'm-b', userId: 'u-outsider', organizationId: 'org-b', role: 'companyAdmin', createdAt: new Date() } })

  // What the demo seed syncs from the simulated Qonto API
  const today = toDateKey(new Date())
  await prisma.bankTransaction.createMany({
    data: profile.engine.transactions(addDays(today, -60), addDays(today, -1)).map((t) => ({
      bankAccountId: ids.aAccount,
      externalTransactionId: t.transactionId,
      amount: t.amount.toFixed(2),
      side: t.side,
      date: new Date(`${t.date}T00:00:00.000Z`),
      label: t.label,
    })),
  })
}

const as = (who: keyof typeof USERS) => {
  state.user = { ...USERS[who] }
}
const get = (handler: Handler, path: string, params: Record<string, string> = {}) =>
  handler(new NextRequest(`http://localhost${path}`), { params: Promise.resolve(params) })

describe.skipIf(!available)('demo sample routes', () => {
  const previous = process.env.KLEDG_DEMO_MODE

  beforeAll(async () => {
    await prepareTestDatabase('demo_samples')
    ;({ prisma } = await import('@/lib/prisma'))
    LIST = ((await import('@/app/api/demo/samples/route')) as unknown as { GET: Handler }).GET
    FILE = ((await import('@/app/api/demo/samples/[format]/route')) as unknown as { GET: Handler }).GET
    IMPORT = ((await import('@/app/api/banking/import-statement/route')) as unknown as { POST: Handler }).POST
    await seed()
  }, 60_000)

  beforeEach(() => {
    process.env.KLEDG_DEMO_MODE = 'true'
  })

  afterEach(() => {
    process.env.KLEDG_DEMO_MODE = previous
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('answers 404 outside demo mode, even to a member', async () => {
    process.env.KLEDG_DEMO_MODE = 'false'
    as('member')
    expect((await get(LIST, `/api/demo/samples?companyId=${ids.aCompany}`)).status).toBe(404)
    expect((await get(FILE, `/api/demo/samples/csv?companyId=${ids.aCompany}`, { format: 'csv' })).status).toBe(404)
  })

  it('answers 404 to a user who is not a member of the company', async () => {
    as('outsider')
    expect((await get(LIST, `/api/demo/samples?companyId=${ids.aCompany}`)).status).toBe(404)
    expect((await get(FILE, `/api/demo/samples/ofx?companyId=atelier-lumen`, { format: 'ofx' })).status).toBe(404)
  })

  it('answers 404 for a company without a demo profile and for an unknown format', async () => {
    as('outsider')
    expect((await get(LIST, `/api/demo/samples?companyId=${ids.bCompany}`)).status).toBe(404)
    as('member')
    expect((await get(FILE, `/api/demo/samples/pdf?companyId=${ids.aCompany}`, { format: 'pdf' })).status).toBe(404)
  })

  it('lists the files and the bank account they belong to', async () => {
    as('member')
    const response = await get(LIST, `/api/demo/samples?companyId=atelier-lumen`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { bankAccountId: string; files: Array<{ format: string; url: string }>; lines: { existing: number; new: number } }
    expect(body.bankAccountId).toBe(ids.aAccount)
    expect(body.files.map((f) => f.format)).toEqual(['csv', 'ofx', 'camt053', 'boursobank'])
    expect(body.files[1].url).toBe(`/api/demo/samples/ofx?companyId=${ids.aCompany}`)
    expect(body.lines.existing).toBeGreaterThan(0)
    expect(body.lines.new).toBeGreaterThan(0)
  })

  it('serves the same file twice in a day, as an attachment, with the account number of the demo account', async () => {
    as('member')
    const first = await get(FILE, `/api/demo/samples/ofx?companyId=${ids.aCompany}`, { format: 'ofx' })
    const second = await get(FILE, `/api/demo/samples/ofx?companyId=${ids.aCompany}`, { format: 'ofx' })
    expect(first.headers.get('content-disposition')).toMatch(/^attachment; filename="releve-atelier-lumen-\d{8}\.ofx"/)
    const text = await first.text()
    expect(text).toBe(await second.text())
    const acctid = /<ACCTID>(\d+)<\/ACCTID>/.exec(text)?.[1]
    expect(profile.bankAccount.iban).toContain(acctid)
    const camt = await (await get(FILE, `/api/demo/samples/camt053?companyId=${ids.aCompany}`, { format: 'camt053' })).text()
    expect(camt).toContain(`<IBAN>${profile.bankAccount.iban}</IBAN>`)
  })

  it.each(['csv', 'ofx', 'camt053', 'boursobank'])('a %s sample previews as new lines plus probable duplicates, without account warning', async (format) => {
    as('member')
    const file = await get(FILE, `/api/demo/samples/${format}?companyId=${ids.aCompany}`, { format })
    const form = new FormData()
    form.append('companyId', ids.aCompany)
    form.append('bankAccountId', ids.aAccount)
    form.append('mode', 'preview')
    form.append('file', new File([await file.arrayBuffer()], 'sample'))
    const response = await IMPORT(new NextRequest('http://localhost/api/banking/import-statement', { method: 'POST', body: form }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { summary: { new: number; probable: number; duplicates: number }; errors: unknown[] }
    const lines = sampleLines(profile, toDateKey(new Date()))
    expect(body.errors).toEqual([])
    expect(body.summary).toMatchObject({
      new: lines.filter((l) => !l.existing).length,
      probable: lines.filter((l) => l.existing).length,
      duplicates: 0,
    })
  })
})
