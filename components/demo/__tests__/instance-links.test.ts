import { describe, expect, it } from 'vitest'
import { findSettingsEntry, visibleSettingsGroups } from '@/components/layout/settings-nav-config'

const links = { instance: '/demo/instance', users: '/demo/users', updates: '/demo/updates' }
// The demo policy hides Kledg's instance entries from the user menu.
const visible = ['profile', 'assistants', 'api-keys'] as const

describe('settings sidebar with the instance links of the Administrateur persona', () => {
  it('shows the "Instance" group with the demo pages to a non administrator, and nothing without links', () => {
    const groups = visibleSettingsGroups(false, visible, links)
    const instance = groups.find((g) => g.label === 'Instance')!
    expect(instance.items.map((i) => [i.title, i.url])).toEqual([
      ['Configuration', '/demo/instance'],
      ['Utilisateurs', '/demo/users'],
      ['Mises à jour', '/demo/updates'],
    ])
    expect(visibleSettingsGroups(false, visible).some((g) => g.label === 'Instance')).toBe(false)
    expect(visibleSettingsGroups(false, visible, null).some((g) => g.label === 'Instance')).toBe(false)
  })

  it('keeps Kledg pages for administrators, and names the demo pages in the breadcrumb', () => {
    const instance = visibleSettingsGroups(true, undefined, links).find((g) => g.label === 'Instance')!
    expect(instance.items.map((i) => i.url)).toContain('/settings/users')
    expect(findSettingsEntry('/demo/users', links)).toEqual({ group: 'Instance', title: 'Utilisateurs', url: '/demo/users' })
    expect(findSettingsEntry('/demo/users')).toBeNull()
  })
})
