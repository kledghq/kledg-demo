/**
 * The persona of a private demo sandbox (./persona.ts), read from the
 * visitor's roles in its companies: nothing else stores it, so a reset or a
 * switch only has to seed the companies with the right roles.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sandboxKeyOf } from './identity'
import { personaOfRoles, type DemoPersona } from './persona'

type Db = Prisma.TransactionClient | typeof prisma

// The session is loaded on use: the instance slots import this module, and
// so do tests that render them without a database.
const sessionModule = () => import('@/lib/session')

/**
 * The persona of a sandbox user (personaOfRoles). A sandbox without
 * companies (seed failed) is a director's.
 */
export async function sandboxPersona(userId: string, db: Db = prisma): Promise<DemoPersona> {
  const memberships = await db.member.findMany({ where: { userId }, select: { role: true, organizationId: true }, take: 10 })
  const roles = memberships.flatMap((m) => m.role.split(',').map((r) => r.trim()))
  // The fictional managers are the only other members of a sandbox's companies.
  const others = memberships.length
    ? await db.member.count({ where: { organizationId: { in: memberships.map((m) => m.organizationId) }, userId: { not: userId } } })
    : 0
  return personaOfRoles(roles, others > 0)
}

/** The signed-in visitor's sandbox and its persona, or null (anonymous, or not a sandbox account). */
export async function currentSandbox(): Promise<{ persona: DemoPersona } | null> {
  const { getCurrentUser } = await sessionModule()
  const user = await getCurrentUser()
  if (!user || !sandboxKeyOf(user.email)) return null
  const hasCompanies = await prisma.member.count({ where: { userId: user.id } })
  return hasCompanies > 0 ? { persona: await sandboxPersona(user.id) } : null
}
