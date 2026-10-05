/**
 * The fictional people of the demo group (group.ts): who owns Lumen Holding
 * and the SCI, and who runs each company. Pure: no database. Seeded as
 * Persons of each company they belong to (Kledg's persons are per company),
 * natural-person shareholders (type PHYSICAL) where they hold shares, with
 * their office in the notes (Kledg has no officers table).
 *
 * The photos are AI-generated faces (thispersondoesnotexist.com, see
 * README.md): they depict no real person.
 */

import { HOLDING_SLUG, LUMEN_SLUG, TILLEULS_SLUG, VERDIER_SLUG } from '../qonto/profiles/group'
import { PEOPLE_PHOTOS } from './photos'

export interface DemoPerson {
  key: string
  firstName: string
  name: string
  birthDate: string
  birthCity: string
  birthDepartment: string
}

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  { key: 'claire-vasseur', firstName: 'Claire', name: 'Vasseur', birthDate: '1986-04-17', birthCity: 'Lyon', birthDepartment: '69' },
  { key: 'marc-vasseur', firstName: 'Marc', name: 'Vasseur', birthDate: '1983-11-02', birthCity: 'Lyon', birthDepartment: '69' },
  { key: 'thomas-verdier', firstName: 'Thomas', name: 'Verdier', birthDate: '1984-09-23', birthCity: 'Bordeaux', birthDepartment: '33' },
  { key: 'helene-garnier', firstName: 'Hélène', name: 'Garnier', birthDate: '1972-02-08', birthCity: 'Villeurbanne', birthDepartment: '69' },
]

/** What a person is in a company: shareholder (shares of the company's capital), officer, or both. */
export interface DemoPersonRole {
  company: string
  person: string
  /** Shares or parts held (their percentage of the company's capital is derived). */
  shares?: number
  /** Office held, consistent with the legal form: président(e) of an SAS, gérant(e) of an EURL or SCI. */
  office?: string
}

export const DEMO_PERSON_ROLES: readonly DemoPersonRole[] = [
  // Lumen Holding: 24,000 shares, each founder's contribution at 10 EUR a share (group.ts).
  { company: HOLDING_SLUG, person: 'claire-vasseur', shares: 12000, office: 'Présidente' },
  { company: HOLDING_SLUG, person: 'thomas-verdier', shares: 8400 },
  { company: HOLDING_SLUG, person: 'marc-vasseur', shares: 3600 },
  // Subsidiaries wholly owned by the holding: their officers only.
  { company: LUMEN_SLUG, person: 'claire-vasseur', office: 'Présidente' },
  { company: VERDIER_SLUG, person: 'thomas-verdier', office: 'Gérant non associé, à titre gratuit' },
  // SCI Les Tilleuls: 60 of its 100 parts, the holding has the 40 others.
  { company: TILLEULS_SLUG, person: 'helene-garnier', shares: 60, office: 'Gérante' },
]

export function demoPerson(key: string): DemoPerson {
  const person = DEMO_PEOPLE.find((p) => p.key === key)
  if (!person) throw new Error(`Unknown demo person ${key}`)
  return person
}

/** The person's photo, a data URL as Kledg stores it (Person.photo, like company logos). */
export function demoPersonPhoto(key: string): string {
  const photo = PEOPLE_PHOTOS[key]
  if (!photo) throw new Error(`No photo for demo person ${key}`)
  return photo
}

/** Fictional email of a person in a company (the company's domain, .example). */
export function demoPersonEmail(person: DemoPerson, companyEmail: string): string {
  const domain = companyEmail.split('@')[1]
  const local = `${person.firstName}.${person.name}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return `${local}@${domain}`
}

/** Notes of the person in a company: the office held. */
export function demoPersonNotes(role: DemoPersonRole): string | null {
  return role.office ? `${role.office} de la société (personnage fictif de la démo).` : 'Associé (personnage fictif de la démo).'
}
