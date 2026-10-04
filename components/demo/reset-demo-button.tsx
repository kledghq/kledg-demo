'use client'

import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RebuildDemoDialog, useDemoDialog, type RebuildDemoResult } from './rebuild-demo-dialog'

export type ResetDemoResult = RebuildDemoResult

/** "Réinitialiser ma démo" in the demo banner: confirmation, then the server action `reset`. */
export function ResetDemoButton({ reset }: { reset: () => Promise<ResetDemoResult> }) {
  const [open, setOpen] = useDemoDialog()
  return (
    <>
      <Button type="button" variant="link" size="xs" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        Réinitialiser ma démo
      </Button>
      <RebuildDemoDialog
        open={open}
        onOpenChange={setOpen}
        title="Réinitialiser votre démo ?"
        summary="Les quatre sociétés reviennent à leur état de départ, avec le même profil."
        confirmLabel="Réinitialiser"
        tone="destructive"
        run={reset}
        failureMessage="La réinitialisation a échoué. Réessayez dans un instant."
      />
    </>
  )
}
