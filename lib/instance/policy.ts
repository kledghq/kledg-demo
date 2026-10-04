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

import { demoIsActionAllowed, demoRefusalMessage, DEMO_SELF_AUTHENTICATED_API_ROUTES } from '@/lib/demo/policy'
import type { InstanceAction, InstanceActor } from './types'

/**
 * Whether `actor` may perform `action` on this instance. `actor` is null for
 * anonymous requests (password reset request, first-run setup, emails).
 */
export async function isActionAllowed(action: InstanceAction, actor: InstanceActor | null = null): Promise<boolean> {
  return demoIsActionAllowed(action, actor)
}

/** French message of the 403 answered when `action` is refused. */
export function actionRefusalMessage(action: InstanceAction): string {
  return demoRefusalMessage(action)
}

/**
 * API paths (prefixes of the request path) served by routes that
 * authenticate requests themselves, with the reason. The proxy lets them
 * through without a session and the route architecture test
 * (lib/api/__tests__/routes.test.ts) accepts their handlers unwrapped.
 */
export const SELF_AUTHENTICATED_API_ROUTES: Readonly<Record<string, string>> = DEMO_SELF_AUTHENTICATED_API_ROUTES
