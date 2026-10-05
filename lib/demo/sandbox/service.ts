/**
 * Private demo sandboxes: one temporary account per visitor, with its own
 * copy of the four demo companies (lib/demo/seed.ts).
 *
 * - provisionSandbox: admission (cap, per-IP rate limit), the account
 *   (visiteur-<key>@demo.kledg.com, role "user", random password never
 *   shown), then the seed in the chosen persona (./persona.ts). Sign-in is
 *   done by the caller (./actions.ts).
 * - resetSandbox: deletes the visitor's companies (and everything that
 *   hangs off them: ledger, bank data, rules, imported statements, AI
 *   grants for them) and the fictional directors of the accountant
 *   persona, and seeds them again in the same persona, or in the other one
 *   to switch; same account, same session.
 * - cleanupSandboxes: the nightly job deletes sandboxes inactive for more
 *   than DEMO_SANDBOX_TTL_HOURS, every row included (fictional directors
 *   too).
 *
 * Isolation comes from Kledg itself: sandbox users are plain users (never
 * instance administrators), companyAdmin or accountant of their four
 * companies only, so every route, page and MCP tool scopes them to their
 * own companies. Fictional directors (<login>-<key>@clients.demo.kledg.com)
 * are members of the companies of their sandbox only, have no credentials
 * and are banned: nobody signs in as them.
 *
 * Activity is recorded by ./activity.ts.
 */

import { randomBytes, randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { isDemoMode } from '@/lib/demo/mode'
import { seedDemoCompanies } from '@/lib/demo/seed'
import {
  newSandboxKey,
  SANDBOX_EMAIL_DOMAIN,
  SANDBOX_USER_NAME,
  sandboxEmail,
  sandboxKeyOf,
  sandboxSlugSuffix,
} from './identity'
import {
  DEFAULT_DEMO_PERSONA,
  DIRECTOR_EMAIL_DOMAIN,
  directorEmailPattern,
  directorSandboxKeyOf,
  type DemoPersona,
} from './persona'
import { sandboxPersona } from './membership'

export { sandboxPersona }

type Db = Prisma.TransactionClient | typeof prisma

/** The shared demo account of the first version of the demo, removed by the cleanup. */
export const LEGACY_DEMO_EMAIL = 'demo@kledg.com'

export interface SandboxLimits {
  /** Live sandboxes at most (DEMO_MAX_SANDBOXES). */
  maxSandboxes: number
  /** A sandbox inactive for longer is deleted by the nightly cleanup (DEMO_SANDBOX_TTL_HOURS). */
  ttlHours: number
  /** At the cap, the least recently active sandbox idle for longer is recycled (DEMO_SANDBOX_EVICT_IDLE_MINUTES). */
  evictIdleMinutes: number
  /** Sandboxes created per client IP and hour (DEMO_SANDBOXES_PER_IP_PER_HOUR). */
  perIpPerHour: number
  /** Resets per sandbox and hour. */
  resetsPerHour: number
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function sandboxLimits(env: Record<string, string | undefined> = process.env): SandboxLimits {
  return {
    maxSandboxes: positiveInt(env.DEMO_MAX_SANDBOXES, 200),
    ttlHours: positiveInt(env.DEMO_SANDBOX_TTL_HOURS, 24),
    evictIdleMinutes: positiveInt(env.DEMO_SANDBOX_EVICT_IDLE_MINUTES, 60),
    perIpPerHour: positiveInt(env.DEMO_SANDBOXES_PER_IP_PER_HOUR, 5),
    resetsPerHour: 10,
  }
}

const SANDBOX_EMAIL_SUFFIX = `@${SANDBOX_EMAIL_DOMAIN}`

const MINUTE_MS = 60_000

// ── Activity ───────────────────────────────────────────────────────────────

interface SandboxActivity {
  id: string
  email: string
  lastActiveAt: Date
}

/** Sandbox users idle since before `before`, least recently active first. */
async function idleSandboxes(db: Db, before: Date, limit: number): Promise<SandboxActivity[]> {
  return db.$queryRaw<SandboxActivity[]>`
    SELECT u."id", u."email", a."lastActiveAt"
    FROM "user" u
    CROSS JOIN LATERAL (
      SELECT GREATEST(u."updatedAt", COALESCE(MAX(s."updatedAt"), u."updatedAt")) AS "lastActiveAt"
      FROM "session" s WHERE s."userId" = u."id"
    ) a
    WHERE u."email" LIKE ${`%${SANDBOX_EMAIL_SUFFIX}`} AND a."lastActiveAt" < ${before}
    ORDER BY a."lastActiveAt" ASC
    LIMIT ${limit}
  `
}

export async function countSandboxes(db: Db = prisma): Promise<number> {
  return db.user.count({ where: { email: { endsWith: SANDBOX_EMAIL_SUFFIX } } })
}

// ── Deletion ───────────────────────────────────────────────────────────────

/** The fictional directors of these sandboxes (accountant persona). */
async function directorsOf(db: Db, sandboxKeys: string[]): Promise<Array<{ id: string; email: string }>> {
  if (sandboxKeys.length === 0) return []
  const patterns = sandboxKeys.map(directorEmailPattern)
  const rows = await db.$queryRaw<Array<{ id: string; email: string }>>`
    SELECT "id", "email" FROM "user" WHERE "email" LIKE ANY(${patterns}::text[])
  `
  // The pattern's leading wildcard is checked again on the parsed key.
  return rows.filter((u) => {
    const key = directorSandboxKeyOf(u.email)
    return key !== null && sandboxKeys.includes(key)
  })
}

/**
 * Companies that belong to these sandboxes only: those their visitors are
 * members of, plus those named after their sandbox (a seed interrupted
 * before the memberships were written). A company with a member outside
 * these sandboxes (other than their visitors and fictional directors) is
 * never returned.
 */
async function companiesOwnedBy(db: Db, users: Array<{ id: string; email: string }>): Promise<string[]> {
  if (users.length === 0) return []
  const userIds = users.map((u) => u.id)
  const keys = users.flatMap((u) => {
    const key = sandboxKeyOf(u.email)
    return key ? [key] : []
  })
  const suffixes = keys.map((key) => `%${sandboxSlugSuffix(key)}`)
  const ownIds = [...userIds, ...(await directorsOf(db, keys)).map((d) => d.id)]
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT c."id" FROM "companies" c
    LEFT JOIN "organization" o ON o."companyId" = c."id"
    WHERE (
      EXISTS (SELECT 1 FROM "member" m WHERE m."organizationId" = o."id" AND m."userId" = ANY(${userIds}::text[]))
      OR c."slug" LIKE ANY(${suffixes}::text[])
    )
    AND NOT EXISTS (
      SELECT 1 FROM "member" m WHERE m."organizationId" = o."id" AND NOT (m."userId" = ANY(${ownIds}::text[]))
    )
  `
  return rows.map((r) => r.id)
}

/** Deletes the fictional directors of these sandboxes (in `tx`, after their companies). */
async function deleteDirectorsInTx(tx: Prisma.TransactionClient, sandboxKeys: string[]): Promise<number> {
  const directors = await directorsOf(tx, sandboxKeys)
  if (directors.length === 0) return 0
  const ids = directors.map((d) => d.id)
  const { count } = await tx.user.deleteMany({ where: { id: { in: ids } } })
  return count
}

/** Deletes the companies of a sandbox and its fictional directors (in `tx`). */
async function deleteSandboxCompaniesInTx(tx: Prisma.TransactionClient, user: { id: string; email: string }): Promise<void> {
  await deleteCompaniesInTx(tx, await companiesOwnedBy(tx, [user]))
  const key = sandboxKeyOf(user.email)
  if (key) await deleteDirectorsInTx(tx, [key])
}

/**
 * Deletes companies with every row that depends on them (cascades: ledger,
 * fiscal years, bank connections, accounts and transactions, imported
 * statements, rules, integrations, attachments, organization and members,
 * AI grant scopes) and their addresses. Runs in `tx`.
 *
 * Kledg keeps the books of a real company 10 years: its triggers refuse to
 * delete a closed fiscal year (migration 20261004090000) or a company with
 * books (migration 20261011100000, KLEDG_COMPANY_HAS_BOOKS). Sandbox
 * companies are throwaway copies of fictional books, so this transaction
 * sets the two transaction-scoped bypasses Kledg's triggers honour for such
 * instances (`kledg.company_purge` needs the Kledg migration that adds it).
 *
 * The audit log is append-only (migration 20261011090000): its rows are
 * never deleted here. The company foreign key is ON DELETE SET NULL, so the
 * rows of a deleted sandbox stay, detached from any company.
 */
export async function deleteCompaniesInTx(tx: Prisma.TransactionClient, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return
  await tx.$queryRaw`SELECT set_config('kledg.closed_year_bypass', 'on', true), set_config('kledg.company_purge', 'on', true)`
  await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
  const owned = await tx.company.findMany({
    where: { id: { in: companyIds } },
    select: { addressId: true, headquartersAddressId: true, establishments: { select: { addressId: true } } },
  })
  const addressIds = [
    ...new Set(
      owned.flatMap((c) => [c.addressId, c.headquartersAddressId, ...c.establishments.map((e) => e.addressId)]).filter((id): id is string => !!id),
    ),
  ]
  // Persons only reference their company (no cascade): the demo's fictional
  // shareholders and officers go with it (their shareholder rows cascade).
  await tx.person.deleteMany({ where: { companyId: { in: companyIds } } })
  await tx.company.deleteMany({ where: { id: { in: companyIds } } })
  if (addressIds.length > 0) {
    await tx.address.deleteMany({
      where: {
        id: { in: addressIds },
        companies: { none: {} },
        companiesHeadquarters: { none: {} },
        establishments: { none: {} },
        persons: { none: {} },
      },
    })
  }
}

/** Deletes sandbox users, their companies and every row tied to them (in `tx`). */
async function deleteSandboxUsersInTx(tx: Prisma.TransactionClient, users: Array<{ id: string; email: string }>): Promise<void> {
  const sandboxUsers = users.filter((u) => sandboxKeyOf(u.email))
  if (sandboxUsers.length === 0) return
  const userIds = sandboxUsers.map((u) => u.id)
  await deleteCompaniesInTx(tx, await companiesOwnedBy(tx, sandboxUsers))
  await deleteDirectorsInTx(tx, sandboxUsers.map((u) => sandboxKeyOf(u.email)!))
  // API keys reference their user without a foreign key.
  await tx.apikey.deleteMany({ where: { referenceId: { in: userIds } } })
  await tx.verification.deleteMany({ where: { identifier: { in: sandboxUsers.map((u) => u.email) } } })
  // Cascades: sessions, credentials, memberships, OAuth tokens and consents, AI grants.
  await tx.user.deleteMany({ where: { id: { in: userIds } } })
}

const DELETE_TX = { timeout: 60_000, maxWait: 10_000 } as const

/** Deletes sandboxes (users and all their data). Other accounts are ignored. */
export async function deleteSandboxes(users: Array<{ id: string; email: string }>): Promise<void> {
  await prisma.$transaction((tx) => deleteSandboxUsersInTx(tx, users), DELETE_TX)
}

// ── Creation ───────────────────────────────────────────────────────────────

export type ProvisionResult =
  | {
      ok: true
      userId: string
      sandboxKey: string
      email: string
      persona: DemoPersona
      /** Random, used once by the caller to sign the visitor in; never shown. */
      password: string
      /** Company slugs, first one (alphabetical, like the home page) first. */
      slugs: string[]
      /** Idle sandboxes recycled to make room. */
      evicted: number
      /** Companies whose 2025 balance sheet does not balance (a defect of the demo data; expected empty). */
      unbalanced: string[]
      durationMs: number
    }
  | { ok: false; reason: 'rate-limited' | 'full' }

const ADMISSION_LOCK = 'kledg:demo:sandbox-admission'

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Slugs of the user's companies, alphabetical by name (the home page opens the first). */
export async function sandboxCompanySlugs(userId: string): Promise<string[]> {
  const companies = await prisma.company.findMany({
    where: { organization: { members: { some: { userId } } } },
    orderBy: { name: 'asc' },
    select: { slug: true },
  })
  return companies.map((c) => c.slug)
}

/**
 * Creates a sandbox: account, then its companies. At the cap, the least
 * recently active sandbox idle for evictIdleMinutes is recycled (deleted);
 * when every sandbox is in use the creation is refused ("full"). Admission
 * is serialized with an advisory lock, so concurrent visitors never exceed
 * the cap; the seeds themselves run concurrently.
 */
export async function provisionSandbox(
  options: { ip: string; persona?: DemoPersona; now?: Date; limits?: SandboxLimits; log?: (message: string) => void } = { ip: 'unknown' },
): Promise<ProvisionResult> {
  if (!isDemoMode()) throw new Error('Demo sandboxes need KLEDG_DEMO_MODE=true.')
  const persona = options.persona ?? DEFAULT_DEMO_PERSONA
  const started = Date.now()
  const now = options.now ?? new Date()
  const limits = options.limits ?? sandboxLimits()

  if (
    process.env.RATE_LIMIT_DISABLED !== 'true' &&
    !(await consumeRateLimit(`demo-sandbox|${options.ip}`, { window: 3600, max: limits.perIpPerHour }))
  ) {
    return { ok: false, reason: 'rate-limited' }
  }

  const password = randomBytes(24).toString('base64url')
  const passwordHash = await hashPassword(password)

  const admitted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMISSION_LOCK}))`
    const live = await countSandboxes(tx)
    let evicted = 0
    if (live >= limits.maxSandboxes) {
      const needed = live - limits.maxSandboxes + 1
      const victims = await idleSandboxes(tx, new Date(now.getTime() - limits.evictIdleMinutes * MINUTE_MS), needed)
      if (victims.length < needed) return null
      await deleteSandboxUsersInTx(tx, victims)
      evicted = victims.length
    }
    // A key already taken (about one chance in two billion) is drawn again.
    for (let attempt = 0; attempt < 5; attempt++) {
      const sandboxKey = newSandboxKey()
      const email = sandboxEmail(sandboxKey)
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) continue
      const userId = randomUUID()
      await tx.user.create({
        data: { id: userId, email, name: SANDBOX_USER_NAME, emailVerified: true, role: 'user', createdAt: now, updatedAt: now },
      })
      // Same row as Better Auth's email and password sign-up.
      await tx.authAccount.create({
        data: { id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: passwordHash, createdAt: now, updatedAt: now },
      })
      return { userId, sandboxKey, email, evicted }
    }
    throw new Error('Could not draw a free sandbox key')
  }, DELETE_TX)
  if (!admitted) return { ok: false, reason: 'full' }

  const user = { id: admitted.userId, email: admitted.email }
  let unbalanced: string[]
  try {
    unbalanced = await seedSandboxCompanies(user.id, admitted.sandboxKey, persona, now, options.log)
  } catch (error) {
    await deleteSandboxes([user]).catch((cleanupError: unknown) =>
      logger.error('[demo] could not delete a sandbox whose seed failed', cleanupError),
    )
    throw error
  }
  return {
    ok: true,
    ...admitted,
    persona,
    password,
    slugs: await sandboxCompanySlugs(user.id),
    unbalanced,
    durationMs: Date.now() - started,
  }
}

/**
 * Seeds the companies of a sandbox. A SIREN drawn for this sandbox may
 * already exist (random fictitious numbers): the partial companies are then
 * removed and the seed runs once more with new numbers.
 */
/**
 * The display mode a persona starts in: the director (a manager who is not
 * an accountant) discovers the simple mode, the accountant and the
 * administrator the expert mode. The visitor can switch at any time in the
 * sidebar; a persona switch (a rebuild) sets it again.
 */
export function personaDisplayMode(persona: DemoPersona): 'simple' | 'expert' {
  return persona === 'director' ? 'simple' : 'expert'
}

async function setPersonaDisplayMode(userId: string, persona: DemoPersona): Promise<void> {
  const displayMode = personaDisplayMode(persona)
  await prisma.userPreference.upsert({ where: { userId }, create: { userId, displayMode }, update: { displayMode } })
}

async function seedSandboxCompanies(
  userId: string,
  sandboxKey: string,
  persona: DemoPersona,
  now: Date,
  log?: (message: string) => void,
): Promise<string[]> {
  const unbalanced = (result: Awaited<ReturnType<typeof seedDemoCompanies>>) => {
    const names = result.companies.filter((c) => !c.fiscalYear2025.balanceSheetBalanced).map((c) => c.name)
    if (names.length > 0) logger.warn(`[demo] unbalanced 2025 balance sheet: ${names.join(', ')}`)
    return names
  }
  await setPersonaDisplayMode(userId, persona)
  try {
    return unbalanced(await seedDemoCompanies({ ownerId: userId, sandboxKey, persona, now, log }))
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    logger.warn('[demo] sandbox seed hit a unique constraint, retrying with new numbers')
    await prisma.$transaction((tx) => deleteSandboxCompaniesInTx(tx, { id: userId, email: sandboxEmail(sandboxKey) }), DELETE_TX)
    return unbalanced(await seedDemoCompanies({ ownerId: userId, sandboxKey, persona, now, log }))
  }
}

// ── Reset ──────────────────────────────────────────────────────────────────

export type ResetResult =
  | { ok: true; slugs: string[]; persona: DemoPersona; durationMs: number }
  | { ok: false; reason: 'not-sandbox' | 'rate-limited' }

/**
 * Rebuilds a visitor's companies from scratch: deletes every company of the
 * sandbox (with what the visitor imported, reconciled, created or granted
 * to assistants on them) and its fictional directors, then seeds the four
 * companies again under the same slugs, in the sandbox's persona or in
 * `options.persona` (switching persona). The account, its sessions, API
 * keys and assistant connections are kept. Switches count as resets for
 * the rate limit.
 */
export async function resetSandbox(
  user: { id: string; email: string },
  options: { persona?: DemoPersona; now?: Date; limits?: SandboxLimits } = {},
): Promise<ResetResult> {
  if (!isDemoMode()) throw new Error('Demo sandboxes need KLEDG_DEMO_MODE=true.')
  const sandboxKey = sandboxKeyOf(user.email)
  if (!sandboxKey) return { ok: false, reason: 'not-sandbox' }
  const started = Date.now()
  const now = options.now ?? new Date()
  const limits = options.limits ?? sandboxLimits()
  if (
    process.env.RATE_LIMIT_DISABLED !== 'true' &&
    !(await consumeRateLimit(`demo-reset|${user.id}`, { window: 3600, max: limits.resetsPerHour }))
  ) {
    return { ok: false, reason: 'rate-limited' }
  }
  const persona = options.persona ?? (await sandboxPersona(user.id))
  await prisma.$transaction((tx) => deleteSandboxCompaniesInTx(tx, user), DELETE_TX)
  await seedSandboxCompanies(user.id, sandboxKey, persona, now)
  await prisma.user.update({ where: { id: user.id }, data: { updatedAt: now } })
  return { ok: true, slugs: await sandboxCompanySlugs(user.id), persona, durationMs: Date.now() - started }
}

// ── Cleanup ────────────────────────────────────────────────────────────────

export interface CleanupResult {
  /** Sandboxes deleted for inactivity. */
  deleted: number
  /** Expired sandboxes left for the next run (time budget reached). */
  remaining: number
  /** The shared account of the first demo version was removed. */
  legacyAccountRemoved: boolean
  /** Companies without any member (interrupted seeds) removed. */
  orphanCompanies: number
  /** Fictional directors whose visitor no longer exists, removed. */
  orphanDirectors: number
  /** Live sandboxes after the cleanup. */
  live: number
}

/**
 * Deletes sandboxes inactive for more than ttlHours, in small transactions
 * until `budgetMs` is spent; removes the shared account of the first demo
 * version and companies left without members.
 */
export async function cleanupSandboxes(
  options: { now?: Date; limits?: SandboxLimits; budgetMs?: number; batchSize?: number } = {},
): Promise<CleanupResult> {
  if (!isDemoMode()) throw new Error('Demo sandboxes need KLEDG_DEMO_MODE=true.')
  const now = options.now ?? new Date()
  const limits = options.limits ?? sandboxLimits()
  const deadline = Date.now() + (options.budgetMs ?? 40_000)
  const batchSize = options.batchSize ?? 10
  const before = new Date(now.getTime() - limits.ttlHours * 60 * MINUTE_MS)

  let deleted = 0
  while (Date.now() < deadline) {
    const batch = await idleSandboxes(prisma, before, batchSize)
    if (batch.length === 0) break
    await deleteSandboxes(batch)
    deleted += batch.length
  }
  const remaining = (await idleSandboxes(prisma, before, 10_000)).length

  // The shared demo account (and its companies) of the first demo version.
  const legacy = await prisma.user.findUnique({ where: { email: LEGACY_DEMO_EMAIL }, select: { id: true } })
  if (legacy) {
    await prisma.$transaction(async (tx) => {
      const companies = await tx.company.findMany({
        where: { organization: { members: { some: { userId: legacy.id } } } },
        select: { id: true },
      })
      await deleteCompaniesInTx(tx, companies.map((c) => c.id))
      await tx.apikey.deleteMany({ where: { referenceId: legacy.id } })
      await tx.user.delete({ where: { id: legacy.id } })
    }, DELETE_TX)
  }

  // Every company of a demo instance has a member; one without, older than
  // any seed in progress, is a leftover.
  const orphans = await prisma.company.findMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - 60 * MINUTE_MS) },
      OR: [{ organization: null }, { organization: { members: { none: {} } } }],
    },
    select: { id: true },
    take: 100,
  })
  if (orphans.length > 0) {
    await prisma.$transaction((tx) => deleteCompaniesInTx(tx, orphans.map((c) => c.id)), DELETE_TX)
  }

  // Fictional directors outlive their visitor only if a deletion was cut
  // short: removed with the companies they are still alone in.
  const directorRows = await prisma.user.findMany({
    where: { email: { endsWith: `@${DIRECTOR_EMAIL_DOMAIN}` }, createdAt: { lt: new Date(now.getTime() - 60 * MINUTE_MS) } },
    select: { email: true },
    take: 500,
  })
  const directorKeys = [...new Set(directorRows.map((d) => directorSandboxKeyOf(d.email)).filter((key): key is string => !!key))]
  const liveVisitors = new Set(
    (await prisma.user.findMany({ where: { email: { in: directorKeys.map(sandboxEmail) } }, select: { email: true } })).map((u) => u.email),
  )
  const orphanKeys = directorKeys.filter((key) => !liveVisitors.has(sandboxEmail(key)))
  let orphanDirectorCount = 0
  if (orphanKeys.length > 0) {
    orphanDirectorCount = await prisma.$transaction(async (tx) => {
      const ids = (await directorsOf(tx, orphanKeys)).map((d) => d.id)
      const companies = await tx.company.findMany({
        where: {
          organization: { members: { some: { userId: { in: ids } } } },
          NOT: { organization: { members: { some: { userId: { notIn: ids } } } } },
        },
        select: { id: true },
      })
      await deleteCompaniesInTx(tx, companies.map((c) => c.id))
      return deleteDirectorsInTx(tx, orphanKeys)
    }, DELETE_TX)
  }

  return {
    deleted,
    remaining,
    legacyAccountRemoved: !!legacy,
    orphanCompanies: orphans.length,
    orphanDirectors: orphanDirectorCount,
    live: await countSandboxes(),
  }
}
