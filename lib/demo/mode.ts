/**
 * Public demo mode (KLEDG_DEMO_MODE=true) of the kledg-demo fork.
 *
 * A demo instance gives every visitor a private sandbox (./sandbox): a
 * temporary account with its own copy of fictional companies, deleted after
 * a day of inactivity, a simulated Qonto API served by the instance itself,
 * and a few sensitive actions disabled (./policy.ts). Pure: the request
 * proxy reaches this module through lib/instance/policy.ts.
 */

/** Path of the simulated Qonto API on this instance (QONTO_API_URL points here). */
export const DEMO_QONTO_API_PATH = '/api/demo/qonto/v2'

export const KLEDG_WEBSITE_URL = 'https://www.kledg.com'

/**
 * The fork's own flag: without it the fork behaves like Kledg (local
 * development, CI, previews), and nothing wipes the database.
 */
export function isDemoMode(): boolean {
  return process.env.KLEDG_DEMO_MODE?.trim().toLowerCase() === 'true'
}
