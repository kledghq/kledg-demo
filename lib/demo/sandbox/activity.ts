/**
 * Activity of the private demo sandboxes: the user's updatedAt, written at
 * most every few minutes when a page of the application frame renders (demo
 * banner) and when the samples panel loads. The cleanup (./service.ts)
 * deletes sandboxes inactive for more than DEMO_SANDBOX_TTL_HOURS; sessions
 * refreshed by Better Auth count as activity too.
 *
 * Calls to the simulated Qonto API do not count: the bank sync cron
 * (05:00 UTC) calls it for every sandbox, so each one was touched daily and
 * the cleanup (03:00 UTC, 22 h later) never found it idle for 24 h.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isDemoMode } from '@/lib/demo/mode'
import { sandboxKeyOf } from './identity'

/** Activity is written at most this often per sandbox. */
export const TOUCH_INTERVAL_MS = 5 * 60_000

async function touch(where: { id: string } | { email: string }, now: Date): Promise<void> {
  try {
    await prisma.user.updateMany({
      where: { ...where, updatedAt: { lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
      data: { updatedAt: now },
    })
  } catch (error) {
    logger.warn('[demo] could not record sandbox activity', error)
  }
}

/** Records activity of a sandbox user (no-op for other users and outside demo mode). */
export async function touchSandbox(user: { id: string; email: string }, now: Date = new Date()): Promise<void> {
  if (!isDemoMode() || !sandboxKeyOf(user.email)) return
  await touch({ id: user.id }, now)
}
