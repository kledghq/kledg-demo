import { track } from '@vercel/analytics'

/** A demo custom event for Vercel Web Analytics. Max 2 props, never user text or company data. */
export function trackDemoEvent(name: string, props: Record<string, string> = {}): void {
  try {
    track(name, props)
  } catch {
    /* analytics must never break the demo */
  }
}
