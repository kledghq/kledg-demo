/**
 * Authorization matrix: the demo sample routes, which exist on the demo
 * instance only. Cases and setup are shared by the matrix files
 * (./helpers/authorization-matrix.ts); this file loads its two routes next to
 * them and runs on its own test database. Kept apart from the shared files
 * so that syncing with Kledg never conflicts on them.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('matrix_demo')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  // Routes that reach Qonto (invoice import) must never leave the machine: a closed local port answers at once
  process.env.QONTO_API_URL = 'http://127.0.0.1:9/v2'
  // Same for the other bank providers (Ponto institutions, Revolut), and any other host is refused below
  process.env.PONTO_API_URL = 'http://127.0.0.1:9'
  process.env.REVOLUT_API_URL = 'http://127.0.0.1:9'
})

vi.mock('@/lib/session', async () => {
  const { session } = await import('@/lib/api/__tests__/helpers/authorization-matrix')
  return { getCurrentUser: async () => session.user }
})

import { available, useMatrix, call, routes, A, Call, Handler } from './helpers/authorization-matrix'

/** The demo routes, loaded next to the routes of the matrix (the coverage test reads them here). */
const DEMO_ROUTE_MODULES = {
  demoSamples: () => import('@/app/api/demo/samples/route'),
  demoSampleFile: () => import('@/app/api/demo/samples/[format]/route'),
}

/**
 * Demo sample statements of company A (lib/demo/samples-route.ts): demo
 * instance only, 404 elsewhere; in demo mode, a company that is not a demo
 * company has no samples (404) once access to it is granted.
 */
// Call's route names are those of the shared module: these two are loaded by this file
const DEMO_READS = [
  { label: 'list demo sample files', route: 'demoSamples', method: 'GET', path: () => `/api/demo/samples?companyId=${A()}` },
  { label: 'download a demo sample file', route: 'demoSampleFile', method: 'GET', path: () => `/api/demo/samples/csv?companyId=${A()}`, params: () => ({ format: 'csv' }) },
] as unknown as Call[]

describe.skipIf(!available)('authorization matrix', () => {
  const reseed = useMatrix('matrix_demo')
  beforeAll(async () => {
    for (const [name, load] of Object.entries(DEMO_ROUTE_MODULES)) routes[name] = (await load()) as unknown as Record<string, Handler>
  })

  describe('demo sample routes', () => {
    beforeAll(reseed)
    afterAll(() => {
      vi.unstubAllEnvs()
    })

    it.each(DEMO_READS.map((c) => [c.label, c] as const))('%s: 404 outside demo mode, even for the company admin', async (_label, c) => {
      expect((await call('companyAdmin', c)).status).toBe(404)
    })

    it.each(DEMO_READS.map((c) => [c.label, c] as const))('%s in demo mode: anonymous 401, member of B 404, no samples for a company outside the demo 404', async (_label, c) => {
      vi.stubEnv('KLEDG_DEMO_MODE', 'true')
      expect((await call('anonymous', c)).status).toBe(401)
      expect((await call('memberB', c)).status).toBe(404)
      expect((await call('viewer', c)).status).toBe(404)
      vi.unstubAllEnvs()
    })
  })
})
