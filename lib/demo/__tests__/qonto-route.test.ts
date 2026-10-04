/**
 * The HTTP route of the simulated Qonto API (app/api/demo/qonto/v2/[...path]):
 * anonymous calls refused first, 404 outside demo mode, each sandbox company
 * answered with its own credentials (and the call counted as activity of its
 * sandbox), the invoicing lists of the Qonto invoice import empty.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const touched = vi.hoisted(() => [] as string[])

vi.mock('@/lib/demo/sandbox/activity', () => ({
  touchSandboxByKey: async (key: string) => {
    touched.push(key)
  },
}))

import { GET } from '@/app/api/demo/qonto/v2/[...path]/route'
import { profileBySlug } from '../qonto/profiles'
import { demoQontoCredentials } from '../qonto/credentials'

const SANDBOX = 'k3x9ab'

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
})

afterEach(() => {
  vi.unstubAllEnvs()
  touched.length = 0
})

function request(path: string[], authorization: string | null) {
  const url = `https://demo.example.com/api/demo/qonto/v2/${path.join('/')}`
  return GET(new Request(url, { headers: authorization ? { authorization } : {} }), { params: Promise.resolve({ path }) })
}

const lumenAuth = () => {
  const { login, secretKey } = demoQontoCredentials(profileBySlug('atelier-lumen'), SANDBOX)
  return `${login}:${secretKey}`
}

describe('simulated Qonto API route', () => {
  it('refuses anonymous calls, and answers 404 outside demo mode', async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'false')
    expect((await request(['organization'], null)).status).toBe(401)
    expect((await request(['organization'], lumenAuth())).status).toBe(404)
  })

  it("serves a sandbox company with its own credentials and counts the call as the sandbox's activity", async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'true')
    expect((await request(['organization'], 'demo:wrong')).status).toBe(401)
    expect(touched).toEqual([])
    const response = await request(['organization'], lumenAuth())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { organization: { slug: string } }
    expect(body.organization.slug).toBe('atelier-lumen')
    expect(touched).toEqual([SANDBOX])
  })

  it('answers the Qonto invoice import with empty lists', async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'true')
    for (const resource of ['clients', 'client_invoices', 'supplier_invoices']) {
      const response = await request([resource], lumenAuth())
      expect(response.status, resource).toBe(200)
      expect(((await response.json()) as Record<string, unknown>)[resource]).toEqual([])
    }
  })
})
