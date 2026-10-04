import { notFound, redirect } from 'next/navigation'
import { getCurrentUser, type CurrentUser } from '@/lib/session'
import { isDemoMode } from '@/lib/demo/mode'
import { isAdminPersona } from './links'

/**
 * The visitor of a demo instance page (app/(account)/demo): signed in and
 * playing the Administrateur persona, else the page does not exist.
 */
export async function requireAdminPersona(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isDemoMode() || !(await isAdminPersona(user))) notFound()
  return user
}

/** The neutral wording of the actions the demo does not run. */
export const DEMO_UNAVAILABLE = 'Non disponible dans la démo'
