import { describe, expect, it } from 'vitest'
import {
  directorEmail,
  directorEmailPattern,
  directorSandboxKeyOf,
  isDemoPersona,
  PERSONA_ROLES,
  personaOfRoles,
} from '../sandbox/persona'
import { sandboxKeyOf } from '../sandbox/identity'
import { DEMO_COMPANIES } from '../companies'
import { roles } from '@/lib/permissions'
import { rolesGrant } from '@/lib/rbac/authorize'

describe('demo personas', () => {
  it('accepts the three personas only', () => {
    expect(isDemoPersona('director')).toBe(true)
    expect(isDemoPersona('accountant')).toBe(true)
    expect(isDemoPersona('admin')).toBe(true)
    for (const value of ['administrator', 'companyAdmin', 'viewer', '', null, undefined, 1]) expect(isDemoPersona(value)).toBe(false)
  })

  it('maps personas to Kledg roles and back', () => {
    // The Administrateur persona is companyAdmin of its companies: never an instance role.
    expect(PERSONA_ROLES).toEqual({ director: 'companyAdmin', accountant: 'accountant', admin: 'companyAdmin' })
    for (const role of Object.values(PERSONA_ROLES)) expect(role in roles).toBe(true)
    expect(personaOfRoles(['accountant'])).toBe('accountant')
    expect(personaOfRoles(['companyAdmin'])).toBe('director')
    expect(personaOfRoles(['accountant', 'companyAdmin'])).toBe('director')
    expect(personaOfRoles([])).toBe('director')
    expect(personaOfRoles(['companyAdmin'], true)).toBe('admin')
    expect(personaOfRoles(['accountant'], true)).toBe('accountant')
    expect(personaOfRoles([], true)).toBe('director')
  })

  it('gives the accountant what the note promises, and nothing it says is reserved to the director (lib/permissions.ts)', () => {
    const accountant = [PERSONA_ROLES.accountant]
    expect(rolesGrant(accountant, { entries: ['validate'] })).toBe(true)
    expect(rolesGrant(accountant, { banking: ['reconcile'] })).toBe(true)
    expect(rolesGrant(accountant, { closing: ['execute'] })).toBe(true)
    expect(rolesGrant(accountant, { reports: ['export'] })).toBe(true)
    expect(rolesGrant(accountant, { banking: ['manage'] })).toBe(false)
    expect(rolesGrant(accountant, { settings: ['update'] })).toBe(false)
    expect(rolesGrant(accountant, { members: ['manage'] })).toBe(false)
    expect(rolesGrant([PERSONA_ROLES.director], { banking: ['manage'], settings: ['update'] })).toBe(true)
  })
})

describe('fictional directors of the accountant persona', () => {
  it('have an email of their own domain, tied to the sandbox key, never a sandbox visitor', () => {
    const email = directorEmail('claire.vasseur', 'k3x9ab')
    expect(email).toBe('claire.vasseur-k3x9ab@clients.demo.kledg.com')
    expect(directorSandboxKeyOf(email)).toBe('k3x9ab')
    expect(directorSandboxKeyOf(email.toUpperCase())).toBe('k3x9ab')
    expect(sandboxKeyOf(email)).toBeNull()
    // Sandboxes are counted by this suffix: a director never matches it.
    expect(email.endsWith('@demo.kledg.com')).toBe(false)
    expect(directorEmailPattern('k3x9ab')).toBe('%-k3x9ab@clients.demo.kledg.com')
    for (const other of ['visiteur-k3x9ab@demo.kledg.com', 'claire-k3x9a@clients.demo.kledg.com', 'claire-k3x9ab@clients.demo.kledg.com.evil', 'x@example.com']) {
      expect(directorSandboxKeyOf(other)).toBeNull()
    }
  })

  it('exist for every demo company, with a valid login', () => {
    for (const company of DEMO_COMPANIES) {
      expect(company.director.name).toBeTruthy()
      expect(directorSandboxKeyOf(directorEmail(company.director.login, 'abc123'))).toBe('abc123')
    }
    // Claire Vasseur runs Atelier Lumen and its holding.
    const logins = DEMO_COMPANIES.map((c) => c.director.login)
    expect(new Set(logins).size).toBe(3)
  })
})
