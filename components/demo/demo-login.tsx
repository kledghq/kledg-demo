import { currentSandbox } from '@/lib/demo/sandbox/membership'
import type { DemoPersona } from '@/lib/demo/sandbox/persona'
import { DemoLoginCard, type EnterDemoResult } from './demo-login-card'

/**
 * The demo card of /login (LoginExtra slot): reads the visitor's sandbox,
 * if they already have one, so the card can offer to go back to it or to
 * recreate it in the other persona.
 */
export async function DemoLogin({
  redirectTo,
  enter,
}: {
  redirectTo: string
  enter: (redirectTo: string, persona: DemoPersona) => Promise<EnterDemoResult>
}) {
  const sandbox = await currentSandbox()
  return <DemoLoginCard redirectTo={redirectTo} enter={enter} current={sandbox?.persona ?? null} />
}
