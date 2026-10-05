/**
 * MCP coverage of the instance's own API routes (docs/extension-points.md).
 * Kledg demo: the simulated Qonto API, the sample files and the sandbox
 * reset stay out of the MCP server.
 */

export type InstanceRouteCoverage = { tools: readonly string[] } | { excluded: string }

const SIMULATED_BANK =
  "API Qonto simulée de la démonstration, appelée par la synchronisation bancaire de Kledg, jamais par un utilisateur ; l'assistant synchronise avec sync_bank_data."
const SAMPLES = "Fichiers d'exemple de la démonstration à télécharger (relevés, FEC) ; l'assistant importe avec import_statement."
const CRON = "Tâche planifiée appelée par la plateforme avec son secret, jamais par un utilisateur."

export const INSTANCE_ROUTE_COVERAGE: Readonly<Record<string, InstanceRouteCoverage>> = {
  'GET /api/cron/reset-demo': { excluded: CRON },
  'GET /api/demo/qonto/v2/[...path]': { excluded: SIMULATED_BANK },
  'POST /api/demo/qonto/v2/[...path]': { excluded: SIMULATED_BANK },
  'GET /api/demo/samples/[format]': { excluded: SAMPLES },
  'GET /api/demo/samples': { excluded: SAMPLES },
}
