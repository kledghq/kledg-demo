import { NextResponse } from 'next/server'
import { handleError } from '@/lib/accounting/errors'
import { isDemoMode } from '@/lib/demo'
import { cleanupSandboxes } from '@/lib/demo/sandbox/service'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Nightly cleanup of the public demo instance: deletes the private sandboxes
 * inactive for more than DEMO_SANDBOX_TTL_HOURS (24 h by default), with all
 * their rows, within a time budget (what is left goes the next night or on
 * the next call). Active sandboxes are never touched. No-op unless
 * KLEDG_DEMO_MODE=true. The path is kept from the first demo version, which
 * reset a shared account here.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isDemoMode()) {
    return NextResponse.json({ skipped: true, reason: 'KLEDG_DEMO_MODE is not enabled' })
  }

  try {
    const result = await cleanupSandboxes()
    logger.info(`[demo] cleanup: ${result.deleted} sandboxes deleted, ${result.remaining} left, ${result.live} live`)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('[demo] cleanup failed:', error)
    const { message, statusCode } = handleError(error)
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}
