import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** An action of an instance page the demo does not run: shown, disabled, with the reason on hover. */
export function UnavailableButton({
  reason,
  variant = 'outline',
  size = 'sm',
  label,
  children,
}: {
  reason: string
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'xs' | 'icon-sm'
  /** Accessible name of an icon only button. */
  label?: string
  children: ReactNode
}) {
  return (
    <span title={label ? `${label}\u00a0: ${reason}` : reason} className="inline-flex">
      <Button type="button" variant={variant} size={size} disabled aria-label={label} aria-description={reason}>
        {children}
      </Button>
    </span>
  )
}
