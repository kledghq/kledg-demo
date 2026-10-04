'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Check, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { announceDemoDialog } from './events'

export type RebuildDemoResult = { ok: true; redirectTo: string } | { ok: false; error: string }

/** What a reset or a persona switch keeps, and what it erases (lib/demo/sandbox/service.ts resetSandbox). */
export const REBUILD_KEEPS: readonly string[] = ['Votre session', 'Vos clés API et assistants connectés']
export const REBUILD_ERASES: readonly string[] = [
  'Écritures et rapprochements',
  'Relevés importés',
  "Règles d'affectation",
  'Accès des assistants IA aux sociétés',
]

/**
 * Steps shown while the server rebuilds the sandbox, with the moment (ms
 * after the click) each is reached. The server action answers once (2 to 5
 * seconds), so the first two follow its usual timing and "Prêt" comes with
 * its answer.
 */
export const REBUILD_STEPS: ReadonlyArray<{ label: string; at: number | null }> = [
  { label: 'Suppression de vos données', at: 0 },
  { label: 'Création des sociétés', at: 800 },
  { label: 'Prêt', at: null },
]

function ImpactList({ label, items, icon: Icon }: { label: string; items: readonly string[]; icon: typeof Check }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <ul className="space-y-1 text-sm" aria-label={label}>
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Progress({ step }: { step: number }) {
  return (
    <ol className="space-y-2 text-sm" aria-live="polite" aria-busy={step < REBUILD_STEPS.length - 1} aria-label="Préparation de votre démo">
      {REBUILD_STEPS.map((s, index) => (
        <li
          key={s.label}
          className={cn('flex items-center gap-2', index > step && 'text-muted-foreground')}
          aria-current={index === step ? 'step' : undefined}
        >
          {index < step || (index === step && s.at === null) ? (
            <Check className="text-success size-4 shrink-0" aria-hidden />
          ) : index === step ? (
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <span className="border-border size-4 shrink-0 rounded-full border" aria-hidden />
          )}
          {s.label}
        </li>
      ))}
    </ol>
  )
}

/**
 * Confirmation of "Réinitialiser ma démo" and "Essayer en tant que ...":
 * a short title, one sentence, the choice of the persona (switch only),
 * what is kept and what is erased, then the progress of the rebuild
 * in place of the details. Neutral confirm button for a persona switch,
 * destructive for a reset. Cancel has the initial focus; nothing closes
 * the dialog while the sandbox is rebuilt.
 */
export function RebuildDemoDialog({
  open,
  onOpenChange,
  title,
  summary,
  children,
  confirmLabel,
  confirmDisabled = false,
  tone,
  run,
  failureMessage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  summary: string
  /** Above what is kept and erased: the choice of the persona (switch only). */
  children?: ReactNode
  confirmLabel: string
  confirmDisabled?: boolean
  tone: 'default' | 'destructive'
  run: () => Promise<RebuildDemoResult>
  failureMessage: string
}) {
  const [step, setStep] = useState<number | null>(null)
  const busy = step !== null

  useEffect(() => {
    if (!busy) return
    const timers = REBUILD_STEPS.flatMap((s, index) => (s.at === null || s.at === 0 ? [] : [setTimeout(() => setStep((current) => (current === null ? current : Math.max(current, index))), s.at)]))
    return () => timers.forEach(clearTimeout)
  }, [busy])

  const fail = (message: string) => {
    toast.error(message)
    setStep(null)
    onOpenChange(false)
  }

  const confirm = async () => {
    setStep(0)
    try {
      const result = await run()
      if (!result.ok) return fail(result.error)
      setStep(REBUILD_STEPS.length - 1)
      // A full load: every page and cached list is rebuilt from the new companies.
      window.location.assign(result.redirectTo)
    } catch {
      fail(failureMessage)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent className="gap-5" onEscapeKeyDown={(event) => busy && event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{busy ? 'Quelques secondes, gardez cette page ouverte.' : summary}</AlertDialogDescription>
        </AlertDialogHeader>

        {busy ? (
          <Progress step={step} />
        ) : (
          <div className="space-y-4">
            {children}
            <div className="grid gap-4 sm:grid-cols-2">
              <ImpactList label="Conservé" items={REBUILD_KEEPS} icon={ShieldCheck} />
              <ImpactList label="Effacé" items={REBUILD_ERASES} icon={RotateCcw} />
            </div>
          </div>
        )}

        {!busy && (
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button variant={tone} disabled={confirmDisabled} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Opens a RebuildDemoDialog and lets the samples panel step aside meanwhile. */
export function useDemoDialog(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(false)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    // The samples panel floats above dialogs: it steps aside meanwhile.
    announceDemoDialog(next)
  }
  return [open, setOpen]
}
