import { KLEDG_WEBSITE_URL } from '@/lib/demo/mode'
import { sandboxKeyOf } from '@/lib/demo/sandbox/identity'
import { touchSandbox } from '@/lib/demo/sandbox/activity'
import { sandboxPersona } from '@/lib/demo/sandbox/membership'
import { PERSONAS, type DemoPersona } from '@/lib/demo/sandbox/persona'
import type { InstanceActor } from '@/lib/instance/types'
import { ResetDemoButton, type ResetDemoResult } from './reset-demo-button'
import { SwitchPersonaButton } from './switch-persona-button'
import { AccountantNote, AccountantPageHint } from './accountant-guide'
import { BannerDetails } from './banner-details'

/**
 * Thin notice above every page of a demo instance (InstanceBanner slot,
 * components/instance/slots.tsx). For a visitor's private sandbox it names
 * the persona ("Démo privée · Expert-comptable"), says how long the sandbox
 * lives, offers to change persona or reset it (same persona), and records
 * the visit as activity (the cleanup deletes sandboxes inactive for 24 h).
 * In the accountant persona it also explains what the role can do, and why
 * on the pages whose actions the role refuses. On narrow screens it keeps
 * to one line: the persona, then "Détails" for the rest.
 */
export async function DemoBanner({
  user,
  reset,
  switchPersona,
}: {
  user: InstanceActor
  reset: () => Promise<ResetDemoResult>
  switchPersona: (persona: DemoPersona) => Promise<ResetDemoResult>
}) {
  const sandbox = sandboxKeyOf(user.email) !== null
  const [persona] = sandbox ? await Promise.all([sandboxPersona(user.id), touchSandbox(user)]) : [null]
  const install = (
    <a href={KLEDG_WEBSITE_URL} className="text-foreground font-medium underline underline-offset-2">
      Installez votre propre instance.
    </a>
  )
  return (
    <div className="bg-surface text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-center text-xs">
      {persona ? (
        <>
          <span>
            <span className="text-foreground font-medium">Démo privée · {PERSONAS[persona].label}</span>
            <span className="hidden md:inline">, réinitialisée automatiquement après 24 h d&apos;inactivité. Données fictives.</span>
          </span>
          <BannerDetails>
            <span className="md:hidden">Réinitialisée automatiquement après 24 h d&apos;inactivité. Données fictives.</span>
            {persona === 'accountant' && <AccountantNote />}
            {install}
            <SwitchPersonaButton current={persona} switchPersona={switchPersona} />
            <ResetDemoButton reset={reset} />
            {persona === 'accountant' && <AccountantPageHint />}
          </BannerDetails>
        </>
      ) : (
        <>
          <span>Démo&nbsp;: données fictives.</span>
          {install}
        </>
      )}
    </div>
  )
}
