/**
 * Shared pieces of the demo sample routes (app/api/demo/samples): demo-mode
 * gate, company profile and bank account lookup. The routes are company
 * routes: a visitor only reaches the companies of their own sandbox.
 */

import { NotFoundError } from '@/lib/accounting/errors'
import { fromQuery, type CompanyResolver } from '@/lib/api/route'
import { prisma } from '@/lib/prisma'
import { isDemoMode } from '@/lib/demo'
import { toDateKey } from '@/lib/demo/qonto/engine'
import type { DemoBankProfile } from '@/lib/demo/qonto/profiles'
import { demoQontoTenantOfLogin } from '@/lib/demo/qonto/credentials'
import { demoProfileOf } from '@/lib/demo/samples'

/** Company from ?companyId=, and a 404 on an instance that is not a demo. */
export const demoCompany: CompanyResolver = async (input) => {
  if (!isDemoMode()) throw new NotFoundError('Ressource introuvable')
  return fromQuery()(input)
}

export interface DemoSampleContext {
  profile: DemoBankProfile
  bankAccountId: string
  today: string
}

/**
 * Demo profile of the company and its bank account (404 when the company is
 * not a demo company). The profile comes from the login of the company's
 * simulated Qonto connection, which survives a slug change; the slug (with
 * its sandbox suffix stripped) is the fallback.
 */
export async function demoSampleContext(companyId: string): Promise<DemoSampleContext> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { slug: true, bankConnections: { where: { provider: 'QONTO' }, select: { login: true } } },
  })
  const login = company?.bankConnections[0]?.login
  const profile = (login ? demoQontoTenantOfLogin(login)?.profile : undefined) ?? (company?.slug ? demoProfileOf(company.slug) : undefined)
  if (!profile) throw new NotFoundError('Ressource introuvable')
  const account =
    (await prisma.bankAccount.findFirst({
      where: { bankConnection: { companyId }, iban: profile.bankAccount.iban },
      select: { id: true },
    })) ?? (await prisma.bankAccount.findFirst({ where: { bankConnection: { companyId } }, select: { id: true } }))
  if (!account) throw new NotFoundError('Ressource introuvable')
  return { profile, bankAccountId: account.id, today: toDateKey(new Date()) }
}
