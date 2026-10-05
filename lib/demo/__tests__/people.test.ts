import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, DEMO_PERSON_ROLES, demoPersonEmail, demoPersonPhoto } from '../people'
import { PEOPLE_PHOTOS } from '../people/photos'
import { DEMO_COMPANIES } from '../companies'

const FOLDER = join(__dirname, '..', 'people')

describe('fictional people of the demo', () => {
  it('each have a small JPEG photo, the same as the file of the folder, as a data URL like Kledg stores it', () => {
    for (const person of DEMO_PEOPLE) {
      const file = readFileSync(join(FOLDER, `${person.key}.jpg`))
      // Small: resized to 256 x 256, under 25 KB.
      expect(file.length).toBeGreaterThan(4000)
      expect(file.length).toBeLessThan(25_000)
      expect([file[0], file[1]]).toEqual([0xff, 0xd8])
      expect(demoPersonPhoto(person.key)).toBe(`data:image/jpeg;base64,${file.toString('base64')}`)
    }
    expect(Object.keys(PEOPLE_PHOTOS).sort()).toEqual(DEMO_PEOPLE.map((p) => p.key).sort())
  })

  it('says in the folder that the faces are AI-generated and depict no real person', () => {
    const readme = readFileSync(join(FOLDER, 'README.md'), 'utf8')
    expect(readme).toContain('thispersondoesnotexist.com')
    expect(readme).toContain('no real person')
  })

  it('have roles in demo companies only, with an officer in each company and fictional emails', () => {
    const slugs = new Set(DEMO_COMPANIES.map((c) => c.profile))
    for (const role of DEMO_PERSON_ROLES) {
      expect(slugs.has(role.company)).toBe(true)
      expect(DEMO_PEOPLE.some((p) => p.key === role.person)).toBe(true)
    }
    // A company's director (lib/demo/companies.ts) is the officer recorded for it.
    for (const company of DEMO_COMPANIES) {
      const officer = DEMO_PERSON_ROLES.find((r) => r.company === company.profile && r.office)!
      const person = DEMO_PEOPLE.find((p) => p.key === officer.person)!
      expect(`${person.firstName} ${person.name}`).toBe(company.director.name)
      expect(demoPersonEmail(person, company.email)).toMatch(/^[a-z.]+@[a-z-]+\.example$/)
    }
  })
})
