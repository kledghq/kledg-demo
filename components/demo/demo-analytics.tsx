'use client'

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'

/** The visitor's sandbox key ends every company slug: `atelier-lumen-1kjd6x` (lib/demo/sandbox/identity.ts). */
const SANDBOX_SLUG = /^\/([a-z0-9-]+)-[a-z0-9]{6}(?=\/|$)/

/**
 * Page path without what identifies a visitor: the sandbox key of the
 * company slug becomes a placeholder and the query string (tokens of reset
 * links, filters) is dropped. Exported for the tests.
 */
export function anonymizeDemoUrl(url: string): string {
  const parsed = new URL(url)
  const path = parsed.pathname.replace(SANDBOX_SLUG, '/$1-[sandbox]')
  return `${parsed.origin}${path}`
}

/** Vercel Web Analytics on the demo: cookieless page views, anonymized paths. */
export function DemoAnalytics() {
  return <Analytics beforeSend={(event: BeforeSendEvent) => ({ ...event, url: anonymizeDemoUrl(event.url) })} />
}
