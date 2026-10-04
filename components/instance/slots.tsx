/**
 * Instance UI slots: the interface side extension point of an instance.
 *
 * kledg-demo override: in demo mode (KLEDG_DEMO_MODE=true) the slots render
 * the demo banner (persona, "Ce que vous pouvez faire" for the accountant,
 * "Essayer en tant que ..." and "Réinitialiser ma démo" for a visitor's
 * private sandbox), the login card where the visitor picks a persona
 * (dirigeant, expert-comptable or administrateur) and enters the demo, and the sample files
 * panel, and the user menu hides the entries the demo policy
 * refuses. Without the flag they render nothing, like in Kledg. The demo
 * components live in components/demo, their server actions in
 * lib/demo/sandbox/actions.ts; keep this file a thin delegation so merges
 * from Kledg stay trivial. See docs/extension-points.md.
 */

import type { InstanceActor } from '@/lib/instance/types'
import type { UserMenuItem } from '@/components/layout/user-menu'
import type { InstanceSettingsLinks, InstanceSettingsPage } from '@/components/layout/settings-nav-config'
import { isActionAllowed } from '@/lib/instance/policy'
import { isDemoMode } from '@/lib/demo/mode'
import { enterDemo, resetDemo, switchDemoPersona } from '@/lib/demo/sandbox/actions'
import { demoInstanceLinks } from '@/lib/demo/admin/links'
import { DemoBanner } from '@/components/demo/demo-banner'
import { DemoLogin } from '@/components/demo/demo-login'
import { DemoSamplesPanel } from '@/components/demo/samples-panel'
import { DemoAnalytics } from '@/components/demo/demo-analytics'

/** Above the header of every page of the application frame (company and settings pages). */
export function InstanceBanner({ user }: { user: InstanceActor }) {
  return isDemoMode() ? <DemoBanner user={user} reset={resetDemo} switchPersona={switchDemoPersona} /> : null
}

/**
 * Above the sign-in card on /login. `redirectTo` is the checked same-origin
 * path to open after signing in.
 */
export function LoginExtra({ redirectTo }: { redirectTo: string }) {
  if (!isDemoMode()) return null
  return <DemoLogin redirectTo={redirectTo} enter={enterDemo} />
}

/**
 * After the content of company pages (a client component reads the company
 * from the URL with useParams). Floating UI goes bottom right: the account
 * menu opens bottom left. Give its root the `data-instance-overlay`
 * attribute so it stays usable above the statement import dialog.
 */
export function CompanyOverlay(props: { user: InstanceActor }) {
  void props
  return isDemoMode() ? <DemoSamplesPanel /> : null
}

/**
 * At the end of <body> on every page. Demo: Vercel Web Analytics (cookieless
 * page views), with the visitor's sandbox key removed from the paths.
 */
export function InstanceDocumentEnd(props: { nonce?: string }) {
  void props
  return isDemoMode() ? <DemoAnalytics /> : null
}

/** The user menu entries (and the matching settings links) shown to `user`: those the policy allows. */
export async function filterUserMenu(items: UserMenuItem[], user: InstanceActor): Promise<UserMenuItem[]> {
  const allowed = await Promise.all(items.map((item) => !item.action || isActionAllowed(item.action, user)))
  return items.filter((_, index) => allowed[index])
}

/**
 * The instance's own versions of the administrators' pages for `user`, who
 * is not an instance administrator, by user menu entry ("instance", "users",
 * "updates"...): the settings sidebar then shows the "Instance" group with
 * these links (and the version line links to "updates"). Kledg: none.
 * kledg-demo: the demo pages of the Administrateur persona (app/(account)/demo).
 */
export async function instanceSettingsLinks(user: InstanceActor): Promise<InstanceSettingsLinks | null> {
  return isDemoMode() ? demoInstanceLinks(user) : null
}

/**
 * The instance's own settings pages for `user` (a billing page, an operator
 * console), added to the settings sidebar and breadcrumb: at the end of the
 * "Compte" group, or of the "Instance" group (instance administrators).
 * Kledg: none.
 */
export async function instanceSettingsPages(user: InstanceActor): Promise<InstanceSettingsPage[]> {
  void user
  return []
}
