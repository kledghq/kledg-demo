#!/usr/bin/env tsx
/**
 * Resets the public demo instance: wipes the database (every visitor's
 * sandbox goes), then optionally creates sandboxes to measure them.
 *
 * Usage: pnpm demo:seed   (requires KLEDG_DEMO_MODE=true)
 *
 * DEMO_SEED_SANDBOXES=n creates n sandboxes one after the other (the way
 * visitors do, without signing in) and prints, per sandbox, the time, the
 * SQL statements sent and the rows and bytes it adds to the database. Set
 * DEMO_SEED_SIMULATED_LATENCY_MS (e.g. 20) to add a delay before each
 * statement and estimate the time against a remote database, and
 * DEMO_SEED_PERSONA=accountant to create accountant sandboxes (fictional
 * directors included) instead of director ones.
 */

import 'dotenv/config'
import pg from 'pg'
import { wipeDemoDatabase } from '../lib/demo/seed'
import { provisionSandbox, sandboxLimits } from '../lib/demo/sandbox/service'
import { isDemoMode } from '../lib/demo'
import { DEFAULT_DEMO_PERSONA, isDemoPersona } from '../lib/demo/sandbox/persona'
import { prisma } from '../lib/prisma'

/** Counts (and optionally delays) every statement sent through node-postgres. */
function instrumentPg(latencyMs: number): { count: () => number } {
  let queries = 0
  const original = pg.Client.prototype.query as (...args: unknown[]) => unknown
  pg.Client.prototype.query = function patched(this: pg.Client, ...args: unknown[]) {
    queries += 1
    if (latencyMs > 0 && typeof args[args.length - 1] !== 'function') {
      return new Promise((resolve) => setTimeout(resolve, latencyMs)).then(() => original.apply(this, args))
    }
    return original.apply(this, args)
  } as typeof pg.Client.prototype.query
  return { count: () => queries }
}

async function databaseFootprint(): Promise<{ bytes: number; rows: number }> {
  // Exact row counts (statistics lag behind) and the size of every table with its indexes.
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `
  let rows = 0
  for (const { tablename } of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "public"."${tablename.replace(/"/g, '""')}"`)
    rows += Number(row.n)
  }
  const [size] = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT COALESCE(SUM(pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass)), 0)::bigint AS bytes
    FROM pg_tables WHERE schemaname = 'public'
  `
  return { bytes: Number(size.bytes), rows }
}

async function main() {
  if (!isDemoMode()) {
    console.error('KLEDG_DEMO_MODE is not "true": refusing to wipe this database.')
    process.exit(1)
  }
  const latencyMs = Number(process.env.DEMO_SEED_SIMULATED_LATENCY_MS) || 0
  const sandboxes = Number(process.env.DEMO_SEED_SANDBOXES) || 0
  const persona = process.env.DEMO_SEED_PERSONA || DEFAULT_DEMO_PERSONA
  if (!isDemoPersona(persona)) throw new Error(`DEMO_SEED_PERSONA must be "director" or "accountant", not "${persona}"`)
  const counter = instrumentPg(latencyMs)

  console.log('[demo] Wiping the database')
  await wipeDemoDatabase()
  if (sandboxes === 0) return

  const limits = { ...sandboxLimits(), maxSandboxes: Math.max(sandboxes, sandboxLimits().maxSandboxes) }
  let previous = await databaseFootprint()
  for (let i = 1; i <= sandboxes; i++) {
    const statements = counter.count()
    const result = await provisionSandbox({ ip: `seed-${i}`, persona, limits })
    if (!result.ok) throw new Error(`Sandbox ${i} refused: ${result.reason}`)
    if (result.unbalanced.length > 0) throw new Error(`Unbalanced 2025 balance sheet: ${result.unbalanced.join(', ')}`)
    const sent = counter.count() - statements
    // Statistics and sizes are read once the writes are visible.
    await prisma.$executeRawUnsafe('ANALYZE')
    const footprint = await databaseFootprint()
    console.log(
      `[demo] ${persona} sandbox ${result.sandboxKey}: ${(result.durationMs / 1000).toFixed(2)} s, ${sent} SQL statements, ` +
        `+${footprint.rows - previous.rows} rows, +${((footprint.bytes - previous.bytes) / 1024 / 1024).toFixed(2)} MB` +
        (latencyMs > 0 ? ` (simulated latency ${latencyMs} ms per statement)` : ''),
    )
    previous = footprint
  }
  console.log(`[demo] total: ${previous.rows} rows, ${(previous.bytes / 1024 / 1024).toFixed(2)} MB for ${sandboxes} sandboxes`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
