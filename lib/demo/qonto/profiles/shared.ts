/**
 * Facts shared by several demo companies, so their books agree. The group
 * itself (what Lumen Holding holds, the management fees, the advance, the
 * invoices between the companies) is in group.ts.
 */

import { scheduledBusinessDay } from '../engine'

/** First day of generated activity for every demo company. */
export const DEMO_EPOCH = '2025-01-01'

/**
 * Dividends paid by Atelier Lumen to Lumen Holding (100% owner): voted at the
 * annual general meeting in June, which approves the accounts of the year
 * before and allocates its result, paid a few days later (régime mère-fille
 * on the holding side, CGI art. 145 and 216).
 */
export function lumenDividend(year: number): { agm: string; payment: string; amount: number } {
  return {
    agm: scheduledBusinessDay(year, 6, 19),
    payment: scheduledBusinessDay(year, 6, 24),
    amount: year <= 2025 ? 15000 : 18000,
  }
}

/** Taxable share of dividends under the parent-subsidiary regime (5% "quote-part de frais et charges"). */
export const PARENT_SUBSIDIARY_EXEMPT_SHARE = 0.95

/** Fictitious bank code of the demo IBANs. */
export const DEMO_BANK_CODE = '99999'

function mod97(digits: string): number {
  let remainder = 0
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97
  return remainder
}

/** French IBAN (FR76...) with a valid RIB key and IBAN checksum. */
export function frenchIban(bank: string, branch: string, account: string): string {
  const ribKey = 97 - mod97(`${bank}${branch}${account}00`)
  const bban = `${bank}${branch}${account}${String(ribKey).padStart(2, '0')}`
  // Country code FR = 15 27, rearranged with "00" check digits.
  const check = 98 - mod97(`${bban}152700`)
  return `FR${String(check).padStart(2, '0')}${bban}`
}

/** True when the IBAN checksum is valid (ISO 13616). */
export function isValidIban(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))
  return mod97(digits) === 1
}

/** Luhn check, used for SIREN and SIRET numbers. */
export function isLuhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}
