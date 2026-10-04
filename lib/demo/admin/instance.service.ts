/**
 * What the instance pages of the Administrateur persona show
 * (app/(account)/demo, see ./links.ts). Read only, and scoped:
 * - users: the visitor's own sandbox accounts (the visitor and the fictional
 *   managers of its sandbox), never another visitor's;
 * - instance status: harmless checks (database reachable, version,
 *   migrations), no configuration value, secret or count of other rows;
 * - updates: the deployed version and a static list of releases.
 */

import { prisma } from '@/lib/prisma'
import { isDatabaseReachable } from '@/lib/health/check-database.service'
import { getDeployedVersion, type DeployedVersion } from '@/lib/updates/version'
import { sandboxKeyOf } from '@/lib/demo/sandbox/identity'
import { directorEmailPattern } from '@/lib/demo/sandbox/persona'

export interface DemoInstanceUser {
  id: string
  name: string
  email: string
  /** The visitor administers the instance; the fictional managers are users. */
  isSelf: boolean
  createdAt: Date
}

/** The accounts of the visitor's sandbox: the visitor first, then its fictional managers by name. */
export async function listSandboxUsers(visitor: { id: string; email: string }): Promise<DemoInstanceUser[]> {
  const key = sandboxKeyOf(visitor.email)
  if (!key) return []
  const rows = await prisma.user.findMany({
    where: { OR: [{ id: visitor.id }, { email: { endsWith: directorEmailPattern(key).slice(1) } }] },
    select: { id: true, name: true, email: true, createdAt: true },
    orderBy: { name: 'asc' },
    take: 20,
  })
  return rows
    .map((row) => ({ ...row, isSelf: row.id === visitor.id }))
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf))
}

export interface DemoInstanceStatus {
  database: boolean
  version: Pick<DeployedVersion, 'version' | 'commit' | 'buildDate' | 'platform'>
  migrations: { applied: number; failed: number; latest: { name: string; appliedAt: Date | null } | null }
}

/** Harmless real checks of the instance. */
export async function demoInstanceStatus(): Promise<DemoInstanceStatus> {
  const { version, commit, buildDate, platform } = getDeployedVersion()
  const database = await isDatabaseReachable()
  let migrations: DemoInstanceStatus['migrations'] = { applied: 0, failed: 0, latest: null }
  if (database) {
    const rows = await prisma.$queryRaw<Array<{ applied: bigint; failed: bigint; latest: string | null; latestAt: Date | null }>>`
      SELECT
        COUNT(*) FILTER (WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS applied,
        COUNT(*) FILTER (WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL) AS failed,
        (SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL ORDER BY "migration_name" DESC LIMIT 1) AS latest,
        (SELECT "finished_at" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL ORDER BY "migration_name" DESC LIMIT 1) AS "latestAt"
      FROM "_prisma_migrations"
    `
    const row = rows[0]
    migrations = {
      applied: Number(row?.applied ?? 0),
      failed: Number(row?.failed ?? 0),
      latest: row?.latest ? { name: row.latest, appliedAt: row.latestAt } : null,
    }
  }
  return { database, version: { version, commit, buildDate, platform }, migrations }
}

export interface DemoRelease {
  version: string
  date: string
  title: string
  notes: readonly string[]
}

/** Recent Kledg releases, as the "Mises à jour" page lists them. */
const RELEASES: readonly Omit<DemoRelease, 'version'>[] = [
  {
    date: '2026-10-03',
    title: 'Sécurité et règles d’affectation',
    notes: [
      'Journal d’audit en ajout seul, sociétés archivées plutôt que supprimées',
      'Règles appliquées automatiquement ou proposées en un clic',
      'Comptes bancaires en euros associés au 5121',
    ],
  },
  {
    date: '2026-09-19',
    title: 'Assistants IA',
    notes: ['Accès des assistants IA par société', 'Actions des assistants à approuver dans Kledg'],
  },
  {
    date: '2026-09-05',
    title: 'Relevés bancaires',
    notes: ['Import CSV, Excel, OFX et camt.053', 'Doublons probables signalés avant l’import'],
  },
]

/** The deployed version first ("installée"), then the two previous ones. */
export function demoReleases(version: string = getDeployedVersion().version): DemoRelease[] {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  return RELEASES.map((release, index) => {
    const p = patch - index
    const v = p >= 0 ? `${major}.${minor}.${p}` : `${major}.${Math.max(minor - 1, 0)}.${9 + p + 1}`
    return { ...release, version: v }
  })
}
