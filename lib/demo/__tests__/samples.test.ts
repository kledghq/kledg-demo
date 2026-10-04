import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The importer module loads the Prisma client (no query runs here).
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://kledg:kledg@localhost:55432/unused'
})
import { DEMO_PROFILES } from '@/lib/demo/qonto/profiles'
import { buildSampleFile, sampleLines, SAMPLE_FORMATS } from '@/lib/demo/samples'
import { parseStatementFile } from '@/lib/banking/import/parse'
import { addDays } from '@/lib/demo/qonto/engine'

const TODAY = '2026-10-03'
const encode = (s: string) => new TextEncoder().encode(s)

describe('demo sample statements', () => {
  it.each(DEMO_PROFILES.map((p) => [p.engine.slug, p] as const))('%s: mixes operations already on the account and new ones', (_slug, profile) => {
    const lines = sampleLines(profile, TODAY)
    const existing = lines.filter((l) => l.existing)
    const fresh = lines.filter((l) => !l.existing)
    expect(existing.length).toBeGreaterThan(0)
    expect(fresh.length).toBeGreaterThanOrEqual(3)

    // Existing lines are operations of the simulated bank history (same day and amount, other wording)
    const real = profile.engine.transactions(addDays(TODAY, -28), addDays(TODAY, -1))
    const key = (date: string, cents: number) => `${date}|${cents}`
    const realKeys = new Set(real.map((t) => key(t.date, Math.round(t.amount * 100) * (t.side === 'debit' ? -1 : 1))))
    for (const l of existing) expect(realKeys.has(key(l.date, l.cents))).toBe(true)
    for (const l of fresh) expect(realKeys.has(key(l.date, l.cents))).toBe(false)
    expect(existing.every((l) => !real.some((t) => t.label === l.label))).toBe(true)

    // Within the four weeks before today
    for (const l of lines) {
      expect(l.date >= addDays(TODAY, -28)).toBe(true)
      expect(l.date < TODAY).toBe(true)
    }
  })

  it.each(DEMO_PROFILES.flatMap((p) => SAMPLE_FORMATS.map((f) => [p.engine.slug, f, p] as const)))(
    '%s %s parses cleanly with the statement parsers',
    async (_slug, format, profile) => {
      const file = buildSampleFile(profile, format, TODAY)
      const parsed = await parseStatementFile(encode(file.content))
      const lines = sampleLines(profile, TODAY)
      expect(parsed.errors).toEqual([])
      expect(parsed.transactions.map((t) => [t.bookingDate, t.amountCents])).toEqual(lines.map((l) => [l.date, l.cents]))
      if (format === 'boursobank') expect(parsed.tabular?.preset?.id).toBe('boursobank')
      if (format === 'csv') expect(parsed.tabular?.confidence).toBe('high')
    },
  )

  it('names the demo account in OFX and camt.053, so the import sees no other account', async () => {
    for (const profile of DEMO_PROFILES) {
      const iban = profile.bankAccount.iban
      const ofx = await parseStatementFile(encode(buildSampleFile(profile, 'ofx', TODAY).content))
      expect(iban).toContain(ofx.accounts[0].accountId)
      expect(ofx.accounts[0].accountId).toHaveLength(11)
      const camt = await parseStatementFile(encode(buildSampleFile(profile, 'camt053', TODAY).content))
      expect(camt.accounts[0].iban).toBe(iban)
    }
  })

  it('is deterministic per company and day', () => {
    const [a, b] = DEMO_PROFILES
    for (const format of SAMPLE_FORMATS) {
      expect(buildSampleFile(a, format, TODAY).content).toBe(buildSampleFile(a, format, TODAY).content)
      expect(buildSampleFile(a, format, TODAY).content).not.toBe(buildSampleFile(b, format, TODAY).content)
    }
    expect(buildSampleFile(a, 'csv', TODAY).content).not.toBe(buildSampleFile(a, 'csv', '2026-10-10').content)
  })

  it('contains no em or en dash', () => {
    for (const profile of DEMO_PROFILES) {
      for (const format of SAMPLE_FORMATS) expect(buildSampleFile(profile, format, TODAY).content).not.toMatch(/[\u2013\u2014]/)
    }
  })
})

describe("Kledg's example OFX statement on a demo account", () => {
  // The import dialog offers public/examples/exemple-releve.ofx (bank 99999,
  // account 00000000001): on a demo account it must match, not warn about another account.
  it('matches every demo bank account', async () => {
    const { selectAccountTransactions } = await import('@/lib/banking/import/importer')
    const parsed = await parseStatementFile(new Uint8Array(readFileSync(join(process.cwd(), 'public/examples/exemple-releve.ofx'))))
    expect(parsed.transactions.length).toBeGreaterThan(0)
    for (const profile of DEMO_PROFILES) {
      const account = { id: 'a', iban: profile.bankAccount.iban, externalAccountId: profile.bankAccount.id, currency: 'EUR' }
      const selected = selectAccountTransactions(parsed, account)
      expect(selected.errors, profile.engine.slug).toEqual([])
      expect(selected.transactions).toHaveLength(parsed.transactions.length)
    }
  })
})
