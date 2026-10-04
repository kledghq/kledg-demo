'use server'

/**
 * Server actions of the private demo sandboxes, handed to the demo
 * components by the instance slots (components/instance/slots.tsx).
 */

import { cookies, headers } from 'next/headers'
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies'
import { clientIpOrUnknown } from '@/lib/client-ip'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { logger } from '@/lib/logger'
import { isDemoMode } from '@/lib/demo/mode'
import { sandboxKeyOf } from './identity'
import { isDemoPersona, type DemoPersona } from './persona'

// Better Auth, the session and the sandbox service are loaded on use: the
// instance slots import this module, and so do tests that render them
// without a database.
const authModule = () => import('@/lib/auth')
const sessionModule = () => import('@/lib/session')
const serviceModule = () => import('./service')

export type SandboxActionResult = { ok: true; redirectTo: string } | { ok: false; error: string }

const UNAVAILABLE = "La démo n'est pas disponible sur cette instance."
const FAILED = 'La préparation de votre démo a échoué. Réessayez dans un instant.'

/**
 * Signs the visitor in as `email` with Better Auth (server side, no
 * plugin): the session cookies Better Auth answers with are copied to the
 * response of the server action.
 */
async function signIn(email: string, password: string): Promise<void> {
  const { auth } = await authModule()
  const { headers: responseHeaders } = await auth.api.signInEmail({
    body: { email, password, rememberMe: true },
    headers: await headers(),
    returnHeaders: true,
  })
  const setCookie = responseHeaders.get('set-cookie')
  if (!setCookie) throw new Error('Better Auth answered the sandbox sign-in without a session cookie')
  const store = await cookies()
  parseSetCookieHeader(setCookie).forEach((value, name) => {
    if (name) store.set(name, value.value, toCookieOptions(value))
  })
}

/** Where to go after entering: the requested page, else the first company. */
function destination(redirectTo: string, slugs: string[]): string {
  const target = safeRedirectPath(redirectTo)
  if (target !== '/') return target
  return slugs[0] ? `/${slugs[0]}` : '/'
}

const RESET_RATE_LIMITED = 'Votre démo a déjà été réinitialisée plusieurs fois cette heure-ci. Réessayez plus tard.'

/**
 * "Entrer dans la démo" with the persona chosen on the login card
 * (director by default): a visitor already in a sandbox goes back to it, or
 * switches it to the chosen persona when it differs (the sandbox is
 * recreated, the card says so first); anyone else gets a new private
 * sandbox and is signed in to it.
 */
export async function enterDemo(redirectTo: string, persona: DemoPersona = 'director'): Promise<SandboxActionResult> {
  if (!isDemoMode()) return { ok: false, error: UNAVAILABLE }
  // A server action's arguments come from the client: checked.
  if (!isDemoPersona(persona)) return { ok: false, error: FAILED }
  try {
    const { getCurrentUser } = await sessionModule()
    const { provisionSandbox, resetSandbox, sandboxCompanySlugs, sandboxPersona } = await serviceModule()
    const current = await getCurrentUser()
    if (current && sandboxKeyOf(current.email)) {
      const slugs = await sandboxCompanySlugs(current.id)
      if (slugs.length > 0) {
        if ((await sandboxPersona(current.id)) === persona) return { ok: true, redirectTo: destination(redirectTo, slugs) }
        const switched = await resetSandbox(current, { persona })
        if (!switched.ok) return { ok: false, error: RESET_RATE_LIMITED }
        return { ok: true, redirectTo: destination(redirectTo, switched.slugs) }
      }
    }

    const ip = clientIpOrUnknown(await headers())
    const sandbox = await provisionSandbox({ ip, persona })
    if (!sandbox.ok) {
      return {
        ok: false,
        error:
          sandbox.reason === 'rate-limited'
            ? 'Vous avez créé plusieurs démos en peu de temps. Réessayez dans une heure, ou continuez avec la démo déjà ouverte.'
            : 'La démo accueille beaucoup de visiteurs en ce moment\u00a0: toutes les places sont occupées. Réessayez dans quelques minutes.',
      }
    }
    logger.info(`[demo] ${sandbox.persona} sandbox ${sandbox.sandboxKey} ready in ${sandbox.durationMs} ms (${sandbox.evicted} recycled)`)
    await signIn(sandbox.email, sandbox.password)
    return { ok: true, redirectTo: destination(redirectTo, sandbox.slugs) }
  } catch (error) {
    logger.error('[demo] sandbox creation failed:', error)
    return { ok: false, error: FAILED }
  }
}

async function rebuild(persona: DemoPersona | undefined): Promise<SandboxActionResult> {
  if (!isDemoMode()) return { ok: false, error: UNAVAILABLE }
  const { getCurrentUser } = await sessionModule()
  const user = await getCurrentUser()
  if (!user || !sandboxKeyOf(user.email)) {
    return { ok: false, error: 'Seule une démo privée peut être réinitialisée.' }
  }
  try {
    const { resetSandbox } = await serviceModule()
    const result = await resetSandbox(user, { persona })
    if (!result.ok) {
      return {
        ok: false,
        error: result.reason === 'rate-limited' ? RESET_RATE_LIMITED : 'Seule une démo privée peut être réinitialisée.',
      }
    }
    return { ok: true, redirectTo: destination('/', result.slugs) }
  } catch (error) {
    logger.error('[demo] sandbox reset failed:', error)
    return { ok: false, error: 'La réinitialisation a échoué. Réessayez dans un instant.' }
  }
}

/** "Réinitialiser ma démo": the visitor's companies rebuilt in the same persona, same account and session. */
export async function resetDemo(): Promise<SandboxActionResult> {
  return rebuild(undefined)
}

/**
 * "Essayer en tant que ...": the sandbox recreated in the other persona,
 * same account and session (counts as a reset for the rate limit).
 */
export async function switchDemoPersona(persona: DemoPersona): Promise<SandboxActionResult> {
  if (!isDemoPersona(persona)) return { ok: false, error: 'Profil de démonstration inconnu.' }
  return rebuild(persona)
}
