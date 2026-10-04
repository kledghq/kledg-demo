'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Keeps the demo banner to one line on narrow screens: the persona stays
 * visible and the rest (lifetime, role explanation, links and actions) sits
 * behind "Détails". From `md` up the details flow inline in the banner as
 * if this wrapper were not there.
 */
export function BannerDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <Button
        type="button"
        variant="link"
        size="xs"
        className="md:hidden"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        Détails
        <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
      </Button>
      <div id={id} className={cn(open ? 'flex' : 'hidden', 'basis-full flex-col items-center gap-1 md:contents')}>
        {children}
      </div>
    </>
  )
}
