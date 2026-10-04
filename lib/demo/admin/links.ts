/**
 * The instance pages of the Administrateur persona (lib/demo/sandbox/persona.ts).
 *
 * A demo visitor is never an instance administrator: every visitor shares
 * one database, so Kledg's own instance pages (and their routes) stay
 * refused to them (role "user", isGlobalAdmin false, the demo policy refuses
 * manage-users and manage-updates). The persona gets the demo's own pages
 * instead (app/(account)/demo), which only read harmless facts or the
 * visitor's own sandbox, and the settings sidebar links them through the
 * instanceSettingsLinks slot (components/instance/slots.tsx).
 */

import type { InstanceActor } from '@/lib/instance/types'
import { sandboxKeyOf } from '@/lib/demo/sandbox/identity'
import { sandboxPersona } from '@/lib/demo/sandbox/membership'

/** URLs of the demo's instance pages, by user menu entry of Kledg's pages. */
export const DEMO_INSTANCE_LINKS = {
  instance: '/demo/instance',
  users: '/demo/users',
  updates: '/demo/updates',
} as const

/** By user menu entry of Kledg's instance pages (InstanceSettingsLinks of components/layout/settings-nav-config.ts). */
export type DemoInstanceLinks = Readonly<Partial<Record<'instance' | 'users' | 'updates', string>>>

/** Whether `user` is a sandbox visitor playing the Administrateur persona. */
export async function isAdminPersona(user: Pick<InstanceActor, 'id' | 'email'> | null): Promise<boolean> {
  if (!user || !sandboxKeyOf(user.email)) return false
  return (await sandboxPersona(user.id)) === 'admin'
}

/** The links of the settings sidebar for `user` (instanceSettingsLinks slot), or null. */
export async function demoInstanceLinks(user: InstanceActor): Promise<DemoInstanceLinks | null> {
  return (await isAdminPersona(user)) ? DEMO_INSTANCE_LINKS : null
}
