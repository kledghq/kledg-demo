/**
 * Activity of the private demo sandboxes: the user's updatedAt, written at
 * most every few minutes when a page of the application frame renders (demo
 * banner), when the samples panel loads and when the simulated Qonto API
 * serves the sandbox. The cleanup (./service.ts) deletes sandboxes inactive
 * for more than DEMO_SANDBOX_TTL_HOURS; sessions refreshed by Better Auth
 * count as activity too.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isDemoMode } from '@/lib/demo/mode'
import { sandboxEmail, sandboxKeyOf } from './identity'

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

/** Same, from the sandbox key (the simulated Qonto API knows the sandbox, not the user). */
export async function touchSandboxByKey(sandboxKey: string, now: Date = new Date()): Promise<void> {
  if (!isDemoMode()) return
  await touch({ email: sandboxEmail(sandboxKey) }, now)
}
