/**
 * Identity of a private demo sandbox (one per visitor), derived from a short
 * random key: the visitor's email, the suffix of the company slugs and the
 * logins of the simulated Qonto API. Pure (Web Crypto only): used by the
 * policy, the seed, the simulated API and the interface.
 *
 * key "k3x9ab" gives
 *   - user        visiteur-k3x9ab@demo.kledg.com (name "Visiteur", random password never shown)
 *   - companies   atelier-lumen-k3x9ab, maison-verdier-k3x9ab, ...
 *   - Qonto       demo-k3x9ab, demo-maison-verdier-k3x9ab, ... (secret derived from the instance key)
 */

/** Domain of the sandbox users' emails: the marker of a sandbox account. */
export const SANDBOX_EMAIL_DOMAIN = 'demo.kledg.com'
export const SANDBOX_USER_NAME = 'Visiteur'

const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const SANDBOX_KEY_LENGTH = 6
const KEY_PATTERN = new RegExp(`^[a-z0-9]{${SANDBOX_KEY_LENGTH}}$`)
const EMAIL_PATTERN = new RegExp(`^visiteur-([a-z0-9]{${SANDBOX_KEY_LENGTH}})@${SANDBOX_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`)
const SUFFIX_PATTERN = new RegExp(`-[a-z0-9]{${SANDBOX_KEY_LENGTH}}$`)

function randomIndexes(count: number, size: number): number[] {
  const bytes = new Uint8Array(count)
  crypto.getRandomValues(bytes)
  // The slight bias of a modulo is irrelevant: these are identifiers, not secrets.
  return [...bytes].map((b) => b % size)
}

/** A new random sandbox key (36^6, about 2 billion values). */
export function newSandboxKey(): string {
  return randomIndexes(SANDBOX_KEY_LENGTH, KEY_ALPHABET.length)
    .map((i) => KEY_ALPHABET[i])
    .join('')
}

export function isSandboxKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}

export function sandboxEmail(key: string): string {
  return `visiteur-${key}@${SANDBOX_EMAIL_DOMAIN}`
}

/** The sandbox key of a user's email, or null for any other account. */
export function sandboxKeyOf(email: string | null | undefined): string | null {
  return EMAIL_PATTERN.exec(email?.trim().toLowerCase() ?? '')?.[1] ?? null
}

export function isSandboxUser(user: { email: string } | null | undefined): boolean {
  return sandboxKeyOf(user?.email) !== null
}

/** Suffix appended to the slugs of a sandbox's companies. */
export function sandboxSlugSuffix(key: string): string {
  return `-${key}`
}

/** The slug without its sandbox suffix ("atelier-lumen-k3x9ab" gives "atelier-lumen"). */
export function stripSandboxSuffix(slug: string): string {
  return slug.replace(SUFFIX_PATTERN, '')
}

/** Login of a company's simulated Qonto account in a sandbox. */
export function sandboxQontoLogin(baseLogin: string, key: string): string {
  return `${baseLogin}-${key}`
}

/**
 * Splits a sandbox Qonto login into the company's base login and the
 * sandbox key; null when the login is not one (`baseLogins` are the known
 * company logins).
 */
export function parseSandboxQontoLogin(
  login: string,
  baseLogins: readonly string[],
): { baseLogin: string; key: string } | null {
  const separator = login.lastIndexOf('-')
  if (separator <= 0) return null
  const baseLogin = login.slice(0, separator)
  const key = login.slice(separator + 1)
  if (!isSandboxKey(key) || !baseLogins.includes(baseLogin)) return null
  return { baseLogin, key }
}

/** Luhn check digit of a string of digits (SIREN, SIRET). */
export function luhnCheckDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    // Doubling starts from the rightmost digit of the payload.
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return (10 - (sum % 10)) % 10
}

/**
 * A random fictitious SIREN passing the Luhn check (starting with 9, like
 * the original demo numbers), and the SIRET of its head office (NIC 0001x).
 */
export function randomSiren(): { siren: string; siret: string } {
  const payload = `9${randomIndexes(7, 10).join('')}`
  const siren = `${payload}${luhnCheckDigit(payload)}`
  const nic = `${siren}0001`
  return { siren, siret: `${nic}${luhnCheckDigit(nic)}` }
}
