'use client'

import { useState } from 'react'
import { ArrowLeftRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { DEMO_PERSONAS, isDemoPersona, PERSONAS, type DemoPersona } from '@/lib/demo/sandbox/persona'
import { RebuildDemoDialog, useDemoDialog } from './rebuild-demo-dialog'
import type { ResetDemoResult } from './reset-demo-button'

/** The personas a visitor can switch to, the current one first (shown, not selectable). */
export function PersonaChoice({
  current,
  value,
  onChange,
}: {
  current: DemoPersona
  value: DemoPersona
  onChange: (persona: DemoPersona) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Profil</legend>
      <RadioGroup value={value} onValueChange={(next) => isDemoPersona(next) && onChange(next)} className="grid gap-2">
        {DEMO_PERSONAS.map((p) => {
          const copy = PERSONAS[p]
          const selected = value === p
          return (
            <label
              key={p}
              htmlFor={`switch-persona-${p}`}
              className={cn(
                'flex items-start gap-2.5 rounded-md border p-3 transition-colors',
                p === current ? 'cursor-default opacity-60' : 'hover:bg-muted/50 cursor-pointer',
                selected && 'border-primary',
              )}
            >
              <RadioGroupItem id={`switch-persona-${p}`} value={p} disabled={p === current} className="mt-0.5" />
              <span className="min-w-0 space-y-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {copy.label}
                  {p === current && <span className="text-muted-foreground text-xs font-normal">en cours</span>}
                </span>
                <span className="text-muted-foreground block text-xs">{copy.description}</span>
                {selected && p !== current && (
                  <ul className="space-y-1 pt-1 text-sm" aria-label={copy.label}>
                    {copy.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            </label>
          )
        })}
      </RadioGroup>
    </fieldset>
  )
}

/**
 * "Changer de profil" in the demo banner: the three personas, the current
 * one marked, then the server action `switchPersona`. Not a destructive
 * action for the visitor (the demo is fictional and rebuilt at once): a
 * neutral confirm button named after the chosen persona.
 */
export function SwitchPersonaButton({
  current,
  switchPersona,
}: {
  current: DemoPersona
  switchPersona: (persona: DemoPersona) => Promise<ResetDemoResult>
}) {
  const [open, setOpen] = useDemoDialog()
  const firstOther = DEMO_PERSONAS.find((p) => p !== current) ?? current
  const [target, setTarget] = useState<DemoPersona>(firstOther)
  const openDialog = () => {
    setTarget(firstOther)
    setOpen(true)
  }
  return (
    <>
      <Button type="button" variant="link" size="xs" onClick={openDialog}>
        <ArrowLeftRight aria-hidden />
        Changer de profil
      </Button>
      <RebuildDemoDialog
        open={open}
        onOpenChange={setOpen}
        title="Changer de profil ?"
        summary="Votre démo est recréée avec le profil choisi, sur les mêmes quatre sociétés."
        confirmLabel={PERSONAS[target].switchAction}
        confirmDisabled={target === current}
        tone="default"
        run={() => switchPersona(target)}
        failureMessage="Le changement de profil a échoué. Réessayez dans un instant."
      >
        <PersonaChoice current={current} value={target} onChange={setTarget} />
      </RebuildDemoDialog>
    </>
  )
}
