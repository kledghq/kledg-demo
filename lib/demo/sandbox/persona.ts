/**
 * Personas of a private demo sandbox: who the visitor plays. Pure (no
 * database, no Node APIs): used by the seed, the sandbox service, the
 * server actions and the interface.
 *
 * - director ("Dirigeant"): companyAdmin of the four companies, like the
 *   manager of a small group running Kledg alone.
 * - accountant ("Expert-comptable"): Kledg's `accountant` role on the four
 *   companies, like an accounting firm with a portfolio of four clients.
 *   Each company also has its fictional manager (a director account,
 *   companyAdmin, that can never sign in), so the members page shows a
 *   real client relationship and the accountant meets the limits of the
 *   role (lib/permissions.ts): no bank connection management, no company
 *   settings, no member management.
 * - admin ("Administrateur"): companyAdmin of the four companies, each with
 *   its fictional manager, and the instance pages of the settings area in
 *   the demo's own versions (app/(account)/demo: état de l'instance,
 *   utilisateurs of the sandbox, mises à jour). The account stays a plain
 *   user (role "user", never an instance administrator: every visitor
 *   shares one database); the demo policy refuses every instance action.
 *
 * Fictional directors live under their own email domain
 * (<login>-<key>@clients.demo.kledg.com), so they never count as sandboxes
 * (visitors are visiteur-<key>@demo.kledg.com) and the sandbox key ties
 * them to their sandbox for the reset and the cleanup.
 */

export const DEMO_PERSONAS = ['director', 'accountant', 'admin'] as const

export type DemoPersona = (typeof DEMO_PERSONAS)[number]

export const DEFAULT_DEMO_PERSONA: DemoPersona = 'director'

export function isDemoPersona(value: unknown): value is DemoPersona {
  return typeof value === 'string' && (DEMO_PERSONAS as readonly string[]).includes(value)
}

/** Role of the visitor in each company of the sandbox (lib/permissions.ts). */
export function personaRole(persona: DemoPersona): 'companyAdmin' | 'accountant' {
  return persona === 'accountant' ? 'accountant' : 'companyAdmin'
}

export const PERSONA_ROLES: Readonly<Record<DemoPersona, 'companyAdmin' | 'accountant'>> = {
  director: personaRole('director'),
  accountant: personaRole('accountant'),
  admin: personaRole('admin'),
}

/** Whether the sandbox's companies have their fictional managers (accountant and admin personas). */
export function personaHasDirectors(persona: DemoPersona): boolean {
  return persona !== 'director'
}

/**
 * The persona of a visitor from their roles in the sandbox's companies and
 * whether the companies have other members (the fictional managers):
 * accountant everywhere is the accountant persona; companyAdmin with the
 * managers is the admin persona, alone the director persona.
 */
export function personaOfRoles(roles: string[], withDirectors = false): DemoPersona {
  if (roles.includes('accountant') && !roles.includes('companyAdmin')) return 'accountant'
  return withDirectors && roles.length > 0 ? 'admin' : 'director'
}

/** How the interface names and presents a persona. */
export interface PersonaCopy {
  /** "Dirigeant", "Expert-comptable": the login card and the banner. */
  label: string
  /** One line under the choice on the login card. */
  description: string
  /** "en tant que dirigeant", "en tant qu'expert-comptable". */
  asPersona: string
  /** Confirm button of the switch to this persona. */
  switchAction: string
  /** What the visitor does with this persona, three short items. */
  highlights: readonly string[]
}

export const PERSONAS: Readonly<Record<DemoPersona, PersonaCopy>> = {
  director: {
    label: 'Dirigeant',
    description: 'Vous dirigez un petit groupe de quatre sociétés\u00a0: banque, saisie, clôture, vue groupe et réglages.',
    asPersona: 'en tant que dirigeant',
    switchAction: 'Passer en dirigeant',
    highlights: [
      'Administrateur des quatre sociétés',
      'Banques, informations et réglages',
      'Exercice 2025 clôturé, 2026 tenu à jour',
    ],
  },
  accountant: {
    label: 'Expert-comptable',
    description: 'Vous tenez les comptes de quatre sociétés clientes de votre cabinet.',
    asPersona: "en tant qu'expert-comptable",
    switchAction: 'Passer en expert-comptable',
    highlights: [
      'Quatre sociétés clientes, chacune avec son dirigeant',
      'Des écritures en brouillon à valider',
      "L'exercice 2025 de Lumen Holding à clôturer",
    ],
  },
  admin: {
    label: 'Administrateur',
    description: "Vous administrez l'instance\u00a0: utilisateurs, mises à jour et état de l'instance.",
    asPersona: "en tant qu'administrateur",
    switchAction: 'Passer en administrateur',
    highlights: [
      "L'état de l'instance et sa version",
      "Les utilisateurs de l'instance",
      'Les mises à jour de Kledg',
    ],
  },
}

/** What the accountant persona can and cannot do (banner note). */
export const ACCOUNTANT_CAN: readonly string[] = [
  'Valider les écritures en brouillon (saisies de la seconde quinzaine du dernier mois tenu)',
  "Rapprocher les opérations bancaires et appliquer les règles d'affectation",
  "Clôturer l'exercice 2025 de Lumen Holding, resté ouvert",
  'Consulter et exporter bilan, compte de résultat, grand livre et FEC',
]

export const ACCOUNTANT_CANNOT: readonly string[] = [
  'Connecter, modifier ou supprimer une banque',
  'Modifier les informations de la société',
  'Gérer les membres',
]

/** Domain of the fictional directors' emails (never a sandbox visitor). */
export const DIRECTOR_EMAIL_DOMAIN = 'clients.demo.kledg.com'

const DIRECTOR_EMAIL_PATTERN = new RegExp(`^[a-z]+(?:\\.[a-z]+)*-([a-z0-9]{6})@${DIRECTOR_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`)

/** Email of a fictional director of a sandbox (`login` like "claire.vasseur"). */
export function directorEmail(login: string, sandboxKey: string): string {
  return `${login}-${sandboxKey}@${DIRECTOR_EMAIL_DOMAIN}`
}

/** The sandbox key of a fictional director's email, or null for any other account. */
export function directorSandboxKeyOf(email: string | null | undefined): string | null {
  return DIRECTOR_EMAIL_PATTERN.exec(email?.trim().toLowerCase() ?? '')?.[1] ?? null
}

/** SQL LIKE pattern matching the fictional directors of a sandbox. */
export function directorEmailPattern(sandboxKey: string): string {
  return `%-${sandboxKey}@${DIRECTOR_EMAIL_DOMAIN}`
}
