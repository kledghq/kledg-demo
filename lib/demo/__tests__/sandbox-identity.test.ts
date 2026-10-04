import { describe, expect, it, vi } from 'vitest'

// sandboxLimits comes from the sandbox service, which imports the Prisma
// client; these tests never query, so a placeholder URL is enough (the pool
// connects lazily, never here).
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:1/unused'
})
import {
  isSandboxKey,
  isSandboxUser,
  newSandboxKey,
  parseSandboxQontoLogin,
  randomSiren,
  sandboxEmail,
  sandboxKeyOf,
  sandboxQontoLogin,
  sandboxSlugSuffix,
  stripSandboxSuffix,
} from '../sandbox/identity'
import { isLuhnValid } from '../qonto/profiles/shared'
import { DEMO_PROFILES } from '../qonto/profiles'
import { demoProfileOf } from '../samples'
import { DEMO_COMPANIES } from '../companies'
import { slugify } from '@/lib/companies/slug'
import { sandboxLimits } from '../sandbox/service'

describe('sandbox identity', () => {
  it('draws random 6-character keys', () => {
    const keys = new Set(Array.from({ length: 200 }, newSandboxKey))
    expect(keys.size).toBe(200)
    for (const key of keys) expect(isSandboxKey(key)).toBe(true)
    expect(isSandboxKey('ABCDEF')).toBe(false)
    expect(isSandboxKey('abcde')).toBe(false)
  })

  it('recognizes sandbox accounts by their email only', () => {
    expect(sandboxEmail('k3x9ab')).toBe('visiteur-k3x9ab@demo.kledg.com')
    expect(sandboxKeyOf('visiteur-k3x9ab@demo.kledg.com')).toBe('k3x9ab')
    expect(sandboxKeyOf(' Visiteur-K3X9AB@demo.kledg.com ')).toBe('k3x9ab')
    expect(sandboxKeyOf('demo@kledg.com')).toBeNull()
    expect(sandboxKeyOf('visiteur-k3x9ab@demo.kledg.com.evil.com')).toBeNull()
    expect(sandboxKeyOf('visiteur-k3x9ab@evil.com')).toBeNull()
    expect(sandboxKeyOf(null)).toBeNull()
    expect(isSandboxUser({ email: 'visiteur-k3x9ab@demo.kledg.com' })).toBe(true)
    expect(isSandboxUser({ email: 'admin@example.com' })).toBe(false)
  })

  it('strips the sandbox suffix of company slugs, and only it', () => {
    for (const company of DEMO_COMPANIES) {
      const base = slugify(company.name)
      expect(stripSandboxSuffix(`${base}${sandboxSlugSuffix('k3x9ab')}`)).toBe(base)
      // The original slugs have no suffix to strip (their last words are not 6 characters).
      expect(stripSandboxSuffix(base)).toBe(base)
    }
  })

  it('finds the bank profile of a sandbox company from its slug (demoProfileOf)', () => {
    for (const company of DEMO_COMPANIES) {
      const slug = `${slugify(company.name)}-k3x9ab`
      expect(demoProfileOf(slug)?.engine.slug).toBe(company.profile)
      expect(demoProfileOf(slugify(company.name))?.engine.slug).toBe(company.profile)
    }
    expect(demoProfileOf('autre-societe-k3x9ab')).toBeUndefined()
  })

  it('parses the Qonto logins of a sandbox', () => {
    const bases = DEMO_PROFILES.map((p) => p.login)
    for (const base of bases) {
      expect(parseSandboxQontoLogin(sandboxQontoLogin(base, 'k3x9ab'), bases)).toEqual({ baseLogin: base, key: 'k3x9ab' })
      // The shared logins of the first demo version are not sandbox logins.
      expect(parseSandboxQontoLogin(base, bases)).toBeNull()
    }
    expect(parseSandboxQontoLogin('other-k3x9ab', bases)).toBeNull()
    expect(parseSandboxQontoLogin('demo-K3X9AB', bases)).toBeNull()
  })

  it('draws fictitious SIREN and SIRET numbers passing the Luhn check', () => {
    for (let i = 0; i < 100; i++) {
      const { siren, siret } = randomSiren()
      expect(siren).toMatch(/^9\d{8}$/)
      expect(siret.startsWith(`${siren}0001`)).toBe(true)
      expect(isLuhnValid(siren)).toBe(true)
      expect(isLuhnValid(siret)).toBe(true)
    }
  })
})

describe('sandbox limits', () => {
  it('reads the environment, with defaults', () => {
    expect(sandboxLimits({})).toMatchObject({ maxSandboxes: 200, ttlHours: 24, evictIdleMinutes: 60, perIpPerHour: 5 })
    expect(
      sandboxLimits({
        DEMO_MAX_SANDBOXES: '50',
        DEMO_SANDBOX_TTL_HOURS: '12',
        DEMO_SANDBOX_EVICT_IDLE_MINUTES: '15',
        DEMO_SANDBOXES_PER_IP_PER_HOUR: '3',
      }),
    ).toMatchObject({ maxSandboxes: 50, ttlHours: 12, evictIdleMinutes: 15, perIpPerHour: 3 })
    expect(sandboxLimits({ DEMO_MAX_SANDBOXES: 'abc' }).maxSandboxes).toBe(200)
    expect(sandboxLimits({ DEMO_MAX_SANDBOXES: '0' }).maxSandboxes).toBe(200)
  })
})
