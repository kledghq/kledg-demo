/**
 * Instance policy: the server side extension point of an instance.
 *
 * kledg-demo override: the demo policy (lib/demo/policy.ts) restricts
 * actions in demo mode and declares the demo's self-authenticated routes.
 * Without KLEDG_DEMO_MODE=true everything is allowed, like in Kledg. Keep
 * this file a thin delegation so merges from Kledg stay trivial, and keep
 * it free of database and Node imports: the request proxy reads
 * SELF_AUTHENTICATED_API_ROUTES. See docs/extension-points.md.
 */

import { demoCompanyCreationRefusal, demoIsActionAllowed, demoRefusalMessage, DEMO_SELF_AUTHENTICATED_API_ROUTES } from '@/lib/demo/policy'
import type { ActionRefusal, InstanceAction, InstanceActor, RateLimitRule } from './types'

/**
 * Whether `actor` may perform `action` on this instance. `actor` is null for
 * anonymous requests (password reset request, first-run setup, emails).
 * Kledg allows every action, 'remove-member' included: a company
 * administrator removes members of their company within the rules of
 * lib/rbac/remove-member.service.ts.
 */
export async function isActionAllowed(action: InstanceAction, actor: InstanceActor | null = null): Promise<boolean> {
  return demoIsActionAllowed(action, actor)
}

/** French message of the 403 answered when `action` is refused. */
export function actionRefusalMessage(action: InstanceAction): string {
  return demoRefusalMessage(action)
}

/**
 * Whether `actor` may create a company (creation wizard, SIREN prefill,
 * POST /api/companies): null when they may, else why not. A user who is not
 * an instance administrator becomes the administrator of the company they
 * create. Kledg: instance administrators only. kledg-demo: the same, with
 * the demo's message (a visitor is never an instance administrator).
 */
export async function companyCreationRefusal(actor: InstanceActor): Promise<ActionRefusal | null> {
  return demoCompanyCreationRefusal(actor)
}

/**
 * Called once `actor` created the company `companyId` (after it is ready).
 * Throwing removes the company and fails the request
 * (lib/companies/create-company.service.ts). Kledg: nothing.
 */
export async function afterCompanyCreated(companyId: string, actor: InstanceActor): Promise<void> {
  void companyId
  void actor
}

/**
 * Why the data of company `companyId` may not change now (a read-only
 * company: an unpaid subscription, for instance), or null. Checked on every
 * write of a company route and of an MCP tool, after the archive check
 * (lib/companies/archive-company.service.ts); reads and exports stay open.
 * Kledg: never refused.
 */
export async function companyWriteRefusal(companyId: string): Promise<ActionRefusal | null> {
  void companyId
  return null
}

/**
 * Companies whose SIREN and establishment SIRETs a company must not repeat,
 * as ids, or null for every company of the instance. `companyId` is the
 * company being changed (null for a creation), `actor` the user creating it
 * (null when unknown). Checked when a company is created or its SIREN
 * changes, and when an establishment is added or its SIRET changes
 * (lib/companies/identifiers.ts). A service whose customers share one
 * database narrows it to the customer's own companies, so that no customer
 * blocks or learns another's identifiers. Kledg: null, one organisation per
 * instance.
 */
export async function companyIdentifierScope(
  companyId: string | null,
  actor: Pick<InstanceActor, 'id' | 'role'> | null,
): Promise<string[] | null> {
  void companyId
  void actor
  return null
}

/**
 * Whether company slugs (the readable segment of company URLs) end with a
 * random suffix, generated ones and those chosen by users alike. Slugs stay
 * unique across the instance; with the suffix, an answer never depends on
 * the slugs of companies the user cannot see. Kledg: false, slugs are
 * derived from the name and numbered on collision.
 */
export function randomCompanySlugSuffix(): boolean {
  return false
}

/**
 * Whether this instance must run with row level security (KLEDG_RLS=enforce,
 * docs/rls.md). When true and the policies are off, the server refuses to
 * start (instrumentation.ts) and the database client refuses to open
 * (lib/prisma.ts), so no request is served without them. Kledg: false.
 */
export function requiresRowLevelSecurity(env: Record<string, string | undefined> = process.env): boolean {
  void env
  return false
}

/**
 * API paths served by routes that authenticate requests themselves, with
 * the reason. A path covers itself and the paths under it, on segment
 * boundaries (lib/instance/api-paths.ts). The proxy lets them
 * through without a session and the route architecture test
 * (lib/api/__tests__/routes.test.ts) accepts their handlers unwrapped.
 */
export const SELF_AUTHENTICATED_API_ROUTES: Readonly<Record<string, string>> = DEMO_SELF_AUTHENTICATED_API_ROUTES

/**
 * Whether accounts must confirm their email address before they can sign in
 * (Better Auth's requireEmailVerification, lib/auth.ts): an unconfirmed
 * account is refused at sign-in and the attempt sends the confirmation link
 * again. Member accounts created from a company's Membres page are marked
 * confirmed (their welcome link proves the address); other accounts confirm
 * at their first sign-in. Kledg: no (accounts are created by the administrator).
 */
export const REQUIRE_EMAIL_VERIFICATION: boolean = false

/**
 * Rate limit rules of the instance's own routes, by name, used like Kledg's
 * (`enforceRateLimit(name, subject)`, lib/rate-limit.ts). A name Kledg
 * already uses keeps Kledg's rule. Kledg: none.
 */
export const INSTANCE_RATE_LIMITS = {} as const satisfies Record<string, RateLimitRule>

/**
 * Pages of the instance that open without a session (a sign-up page, legal
 * notices), as paths: each one and the paths under it. The proxy lets them
 * through like /login; each page decides for itself what it shows.
 */
export const PUBLIC_PAGES: readonly string[] = []

/**
 * Where to send a visitor of /setup without the installation link while
 * the instance has no administrator yet (a hosted service before launch:
 * its waitlist), instead of the neutral "Installation en cours" page.
 * Kledg: null, the neutral page.
 */
export const SETUP_PENDING_REDIRECT: string | null = null
