'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { StatusBadge } from '@/components/shared'
import { cn } from '@/lib/utils'
import {
  DEFAULT_DEMO_PERSONA,
  DEMO_PERSONAS,
  isDemoPersona,
  PERSONAS,
  type DemoPersona,
} from '@/lib/demo/sandbox/persona'

export type EnterDemoResult = { ok: true; redirectTo: string } | { ok: false; error: string }

/**
 * What the server does while the visitor waits, with the moment (ms after
 * the click) a step is shown as reached. The server action answers once,
 * so the steps follow the usual timing of a sandbox creation.
 */
export function demoPreparationSteps(persona: DemoPersona): ReadonlyArray<{ label: string; at: number }> {
  return [
    { label: 'Création de votre compte de démonstration', at: 0 },
    {
      label: persona === 'director' ? 'Copie des quatre sociétés et de leurs écritures' : 'Copie des quatre sociétés et de leurs dirigeants',
      at: 500,
    },
    { label: persona === 'accountant' ? 'Préparation des écritures à valider' : "Clôture de l'exercice 2025", at: 1500 },
    { label: 'Synchronisation des comptes Qonto simulés', at: 2600 },
    { label: 'Connexion', at: 3400 },
  ]
}

function submitLabel(persona: DemoPersona, current: DemoPersona | null): string {
  if (!current) return 'Entrer dans la démo'
  if (current === persona) return 'Retourner à ma démo'
  return `Recréer ma démo ${PERSONAS[persona].asPersona}`
}

/**
 * Shown on /login when the instance runs in demo mode (LoginExtra slot,
 * components/instance/slots.tsx). The visitor picks a persona (dirigeant,
 * expert-comptable or administrateur), then "Entrer dans la démo" creates their private
 * sandbox and signs them in (server action `enter`). A visitor already in a
 * sandbox (`current`) goes back to it, or recreates it in the other
 * persona after being told what is lost.
 */
export function DemoLoginCard({
  redirectTo,
  enter,
  current = null,
}: {
  redirectTo: string
  enter: (redirectTo: string, persona: DemoPersona) => Promise<EnterDemoResult>
  current?: DemoPersona | null
}) {
  const [persona, setPersona] = useState<DemoPersona>(current ?? DEFAULT_DEMO_PERSONA)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const steps = demoPreparationSteps(persona)

  useEffect(() => {
    if (!loading) return
    const timers = demoPreparationSteps(persona).map((s, index) => setTimeout(() => setStep(index), s.at))
    return () => timers.forEach(clearTimeout)
  }, [loading, persona])

  const enterDemo = async () => {
    setError(null)
    setStep(0)
    setLoading(true)
    try {
      const result = await enter(redirectTo, persona)
      if (!result.ok) {
        setError(result.error)
        setLoading(false)
        return
      }
      // A full load: the new session cookie applies to every server component.
      window.location.assign(result.redirectTo)
    } catch {
      setError('La préparation de votre démo a échoué. Réessayez dans un instant.')
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <h2>Instance de démonstration</h2>
          <StatusBadge tone="success">Démo</StatusBadge>
        </CardTitle>
        <CardDescription>
          Explorez Kledg avec quatre sociétés fictives&nbsp;: une SASU de services, une EURL commerçante, une SCI à
          l&apos;IS et une holding, avec des comptes Qonto simulés qui reçoivent de nouvelles transactions chaque
          jour ouvré.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <ol className="space-y-1.5 text-sm" aria-live="polite" aria-busy="true" aria-label="Préparation de votre démo">
            {steps.map((s, index) => (
              <li
                key={s.label}
                className={cn('flex items-center gap-2', index > step && 'text-muted-foreground')}
                aria-current={index === step ? 'step' : undefined}
              >
                {index < step ? (
                  <Check className="text-success size-4 shrink-0" aria-hidden />
                ) : index === step ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                {s.label}
              </li>
            ))}
          </ol>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Votre profil</legend>
              <RadioGroup
                value={persona}
                onValueChange={(value) => isDemoPersona(value) && setPersona(value)}
                className="grid gap-2"
              >
                {DEMO_PERSONAS.map((p) => (
                  <label
                    key={p}
                    htmlFor={`demo-persona-${p}`}
                    className={cn(
                      'hover:bg-muted/50 flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors',
                      persona === p && 'border-primary',
                    )}
                  >
                    <RadioGroupItem id={`demo-persona-${p}`} value={p} className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {PERSONAS[p].label}
                        {current === p && <span className="text-muted-foreground text-xs font-normal">en cours</span>}
                      </span>
                      <span className="text-muted-foreground block text-xs">{PERSONAS[p].description}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            {current && current !== persona ? (
              <p className="text-muted-foreground text-sm" role="status">
                Votre démo est en cours en tant que {PERSONAS[current].label.toLowerCase()}&nbsp;: elle sera recréée avec ce
                profil, et vos modifications seront effacées.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Votre démo est privée&nbsp;: vous seul voyez vos sociétés et ce que vous y faites. Elle est supprimée après
                24 h d&apos;inactivité, et vous pouvez la réinitialiser ou changer de profil à tout moment.
              </p>
            )}
          </>
        )}
      </CardContent>
      <CardFooter>
        <Button type="button" className="w-full" onClick={enterDemo} loading={loading}>
          {loading ? 'Préparation de votre démo' : submitLabel(persona, current)}
        </Button>
      </CardFooter>
    </Card>
  )
}
