import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleError } from '@/lib/accounting/errors'
import { assertActionAllowed, authActionOf, INSTANCE_ACTIONS, isActionAllowed, isSelfAuthenticatedApiPath } from '@/lib/instance'
import { isDemoMode } from '..'
import { ALLOWED_IN_DEMO, REFUSED_IN_DEMO } from '../policy'

const demoUser = { id: 'u1', email: 'demo@kledg.com', role: 'admin' }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('demo mode flag', () => {
  it('is off unless KLEDG_DEMO_MODE is "true"', () => {
    vi.stubEnv('KLEDG_DEMO_MODE', '')
    expect(isDemoMode()).toBe(false)
    vi.stubEnv('KLEDG_DEMO_MODE', '1')
    expect(isDemoMode()).toBe(false)
    vi.stubEnv('KLEDG_DEMO_MODE', 'true')
    expect(isDemoMode()).toBe(true)
    vi.stubEnv('KLEDG_DEMO_MODE', ' TRUE ')
    expect(isDemoMode()).toBe(true)
  })
})

describe('instance policy of the demo (lib/instance/policy.ts override)', () => {
  it('allows everything outside demo mode, like Kledg', async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'false')
    for (const action of INSTANCE_ACTIONS) expect(await isActionAllowed(action, demoUser)).toBe(true)
  })

  it('decides every action of Kledg explicitly: allowed with a reason, or refused with a message', () => {
    for (const action of INSTANCE_ACTIONS) {
      expect(Number(action in ALLOWED_IN_DEMO) + Number(action in REFUSED_IN_DEMO), action).toBe(1)
    }
  })

  it('refuses the sensitive actions in demo mode, even to the demo administrator', async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'true')
    for (const action of INSTANCE_ACTIONS) {
      expect(await isActionAllowed(action, demoUser), action).toBe(action in ALLOWED_IN_DEMO)
    }
    expect(await isActionAllowed('change-appearance', demoUser)).toBe(true)
    const error = await assertActionAllowed('invite-member', demoUser).catch((e: unknown) => e)
    const { message, statusCode } = handleError(error)
    expect(statusCode).toBe(403)
    expect(message).toContain('démonstration')
    expect(message).toContain('https://www.kledg.com')
  })

  it('refuses the email, password and deletion of the profile page, and the guided start, but lets a visitor rename the account', async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'true')
    for (const action of ['change-email', 'change-password', 'delete-account', 'onboarding'] as const) {
      const { message, statusCode } = handleError(await assertActionAllowed(action, demoUser).catch((e: unknown) => e))
      expect(statusCode).toBe(403)
      expect(message).toContain('démonstration')
    }
    // Renaming goes through Better Auth's /update-user, which no instance action guards.
    expect(authActionOf('/update-user')).toBeNull()
    expect(authActionOf('/change-email')).toBe('change-email')
  })

  it('declares the simulated Qonto API and the reset cron as self-authenticated', () => {
    expect(isSelfAuthenticatedApiPath('/api/demo/qonto/v2/organization')).toBe(true)
    expect(isSelfAuthenticatedApiPath('/api/cron/reset-demo')).toBe(true)
    // The sample routes need a session (company route wrapper).
    expect(isSelfAuthenticatedApiPath('/api/demo/samples')).toBe(false)
  })
})
