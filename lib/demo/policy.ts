/**
 * Instance policy of the demo (plugged into Kledg by lib/instance/policy.ts).
 * Pure: no database, no Node APIs (the request proxy imports it).
 *
 * In demo mode a visitor's sandbox account can't change its password or
 * email, delete its account or companies (the sandbox cleanup and the
 * "Réinitialiser ma démo" button do that), manage users, members or updates,
 * or connect a real bank; the instance sends no email and has no first-run
 * setup nor guided start (the companies are seeded). Renaming the account
 * (profile page) stays allowed: it is harmless. The same rules apply to every account of a demo instance (`actor`
 * is not needed to tell them apart).
 */

import type { ActionRefusal, InstanceAction, InstanceActor } from '@/lib/instance/types'
import { DEMO_QONTO_API_PATH, isDemoMode, KLEDG_WEBSITE_URL } from './mode'

const REFUSED: Partial<Record<InstanceAction, string>> = {
  'change-password': 'Le mot de passe du compte de démonstration ne peut pas être modifié.',
  'change-email': "L'email du compte de démonstration ne peut pas être modifié.",
  'delete-account': 'Le compte de démonstration ne peut pas être supprimé.',
  'delete-company': 'Les sociétés de démonstration ne peuvent pas être supprimées\u00a0: utilisez « Réinitialiser ma démo » pour repartir de zéro.',
  'invite-member': "L'invitation de membres par email est désactivée sur l'instance de démonstration.",
  'invitation-sign-up': "La création de compte depuis une invitation est désactivée sur l'instance de démonstration.",
  'manage-users': "La gestion des utilisateurs est désactivée sur l'instance de démonstration.",
  'manage-updates': "Les mises à jour se gèrent sur votre propre instance, pas sur l'instance de démonstration.",
  'connect-bank': "Seule la banque Qonto simulée est disponible sur l'instance de démonstration.",
  'send-email': "Aucun email n'est envoyé depuis l'instance de démonstration.",
  setup: "Pas d'installation sur l'instance de démonstration\u00a0: entrez dans la démo depuis la page de connexion.",
  onboarding: 'Les sociétés de démonstration sont déjà créées et tenues\u00a0: pas de démarrage guidé sur cette instance.',
}

/**
 * Actions a visitor keeps in demo mode, each with the reason. Every other
 * action is refused: a new action of Kledg stays off in the demo until it
 * is listed here or in REFUSED (lib/demo/__tests__/policy.test.ts checks
 * that each action is in exactly one of them).
 */
export const ALLOWED_IN_DEMO: Partial<Record<InstanceAction, string>> = {
  'change-appearance': "The visitor's own chart colours: harmless, kept with the sandbox account.",
}

export const REFUSED_IN_DEMO = REFUSED

const SUFFIX = ` Installez votre propre instance pour utiliser cette fonctionnalité\u00a0: ${KLEDG_WEBSITE_URL}`

const DEFAULT_REFUSAL = "Cette action est désactivée sur cette instance. Contactez l'administrateur de l'instance."

export async function demoIsActionAllowed(action: InstanceAction, actor: InstanceActor | null): Promise<boolean> {
  void actor
  return !isDemoMode() || action in ALLOWED_IN_DEMO
}

export function demoRefusalMessage(action: InstanceAction): string {
  const message = REFUSED[action]
  return message ? message + SUFFIX : DEFAULT_REFUSAL
}

/**
 * Company creation (lib/instance/policy.ts `companyCreationRefusal`): Kledg's
 * rule, instance administrators only. A demo visitor is never one (role
 * "user"), so in demo mode the refusal says why, with the demo's message:
 * the four fictional companies are the demo.
 */
export async function demoCompanyCreationRefusal(actor: InstanceActor): Promise<ActionRefusal | null> {
  if (actor.role === 'admin') return null
  if (isDemoMode()) {
    return { message: `Les sociétés de démonstration sont déjà créées\u00a0: la création de sociétés est désactivée sur l'instance de démonstration.${SUFFIX}` }
  }
  return { message: "La création de sociétés est réservée aux administrateurs de l'instance." }
}

/** Routes of the demo that authenticate requests themselves (see lib/instance/policy.ts). */
export const DEMO_SELF_AUTHENTICATED_API_ROUTES: Readonly<Record<string, string>> = {
  [`${DEMO_QONTO_API_PATH}/`]: 'Simulated Qonto API of the demo: Qonto API key, 404 outside demo mode',
  '/api/cron/reset-demo': 'Vercel cron (sandbox cleanup): requires the CRON_SECRET bearer token, no-op outside demo mode',
}
