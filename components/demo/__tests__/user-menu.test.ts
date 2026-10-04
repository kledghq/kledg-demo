import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterUserMenu } from '@/components/instance/slots'
import { USER_MENU_ITEMS } from '@/components/layout/user-menu'

const demoUser = { id: 'u1', email: 'demo@kledg.com', role: 'admin' }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('demo user menu (filterUserMenu override)', () => {
  it('hides the entries the demo policy refuses, in demo mode only', async () => {
    vi.stubEnv('KLEDG_DEMO_MODE', 'true')
    // The profile page stays (it shows refused actions disabled with the demo message);
    // so do the AI pages (assistants, approvals); the instance welcome (onboarding),
    // account creation and updates go.
    expect((await filterUserMenu([...USER_MENU_ITEMS], demoUser)).map((i) => i.id)).toEqual(['profile', 'appearance', 'assistants', 'api-keys', 'ai-actions'])
    vi.stubEnv('KLEDG_DEMO_MODE', '')
    expect(await filterUserMenu([...USER_MENU_ITEMS], demoUser)).toEqual([...USER_MENU_ITEMS])
  })
})
