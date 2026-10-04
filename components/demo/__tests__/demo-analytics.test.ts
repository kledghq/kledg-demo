import { describe, expect, it } from 'vitest'
import { anonymizeDemoUrl } from '../demo-analytics'

describe('demo analytics', () => {
  it('replaces the sandbox key of the company slug and drops the query string', () => {
    expect(anonymizeDemoUrl('https://demo.kledg.com/atelier-lumen-1kjd6x/reports/sig?year=2026')).toBe(
      'https://demo.kledg.com/atelier-lumen-[sandbox]/reports/sig',
    )
    expect(anonymizeDemoUrl('https://demo.kledg.com/lumen-holding-ab12cd')).toBe('https://demo.kledg.com/lumen-holding-[sandbox]')
  })

  it('leaves the other pages as they are, without their query string', () => {
    expect(anonymizeDemoUrl('https://demo.kledg.com/login?redirect=%2Fx')).toBe('https://demo.kledg.com/login')
    expect(anonymizeDemoUrl('https://demo.kledg.com/settings/appearance')).toBe('https://demo.kledg.com/settings/appearance')
    expect(anonymizeDemoUrl('https://demo.kledg.com/reset-password?token=secret')).toBe('https://demo.kledg.com/reset-password')
  })
})
