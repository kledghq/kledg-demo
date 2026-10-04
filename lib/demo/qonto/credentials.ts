/**
 * Credentials of the simulated Qonto API, one pair per company of each
 * sandbox. The login names the company and the sandbox
 * (lib/demo/sandbox/identity.ts); the secret key is an HMAC of the login
 * with the instance key, so the API checks it without a database and nobody
 * can compute another sandbox's secret. The seed stores it encrypted in the
 * sandbox's Qonto integration like any Qonto API key; it is never shown.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { parseSandboxQontoLogin, sandboxQontoLogin } from '@/lib/demo/sandbox/identity'
import { DEMO_PROFILES, type DemoBankProfile } from './profiles'

const BASE_LOGINS = DEMO_PROFILES.map((p) => p.login)

/** Secret key of a sandbox login; null when the instance has no key (BETTER_AUTH_SECRET or ENCRYPTION_KEY). */
export function demoQontoSecret(login: string): string | null {
  const key = getEncryptionKey()
  if (!key) return null
  return createHmac('sha256', key).update(`kledg-demo:qonto:${login}`).digest('hex').slice(0, 40)
}

export interface DemoQontoTenant {
  profile: DemoBankProfile
  /** Sandbox key the login belongs to. */
  sandboxKey: string
  login: string
}

/** Login and secret of a company profile in a sandbox. */
export function demoQontoCredentials(profile: DemoBankProfile, sandboxKey: string): { login: string; secretKey: string } {
  const login = sandboxQontoLogin(profile.login, sandboxKey)
  const secretKey = demoQontoSecret(login)
  if (!secretKey) throw new Error('Encryption key not configured (BETTER_AUTH_SECRET or ENCRYPTION_KEY).')
  return { login, secretKey }
}

/** Company profile and sandbox of a login, without checking any secret. */
export function demoQontoTenantOfLogin(login: string): DemoQontoTenant | null {
  const parsed = parseSandboxQontoLogin(login, BASE_LOGINS)
  if (!parsed) return null
  const profile = DEMO_PROFILES.find((p) => p.login === parsed.baseLogin)
  return profile ? { profile, sandboxKey: parsed.key, login } : null
}

/** The tenant authenticated by a Qonto "login:secret" authorization header, or null. */
export function authenticateDemoQonto(authorization: string | null): DemoQontoTenant | null {
  const value = authorization?.trim() ?? ''
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const tenant = demoQontoTenantOfLogin(value.slice(0, separator))
  if (!tenant) return null
  const expected = demoQontoSecret(tenant.login)
  const given = value.slice(separator + 1)
  if (!expected || given.length !== expected.length) return null
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? tenant : null
}
