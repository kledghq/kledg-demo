'use client'

import { useParams, usePathname } from 'next/navigation'
import { Check, Info, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ACCOUNTANT_CAN, ACCOUNTANT_CANNOT } from '@/lib/demo/sandbox/persona'
import { announceDemoDialog } from './events'

/**
 * "Ce que vous pouvez faire" in the banner of the accountant persona: the
 * limits of Kledg's accountant role (lib/permissions.ts) in plain words.
 */
export function AccountantNote() {
  return (
    // The samples panel floats above popovers: it steps aside meanwhile.
    <Popover onOpenChange={announceDemoDialog}>
      <PopoverTrigger asChild>
        <Button type="button" variant="link" size="xs">
          <Info aria-hidden />
          Ce que vous pouvez faire
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 space-y-3 text-left text-sm" data-instance-overlay>
        <div className="space-y-1">
          <p className="font-medium">En tant qu&apos;expert-comptable</p>
          <p className="text-muted-foreground text-xs">
            Vous avez le rôle Comptable dans les quatre sociétés clientes ; chacune a son dirigeant, administrateur de
            la société.
          </p>
        </div>
        <ul className="space-y-1.5" aria-label="Vous pouvez">
          {ACCOUNTANT_CAN.map((item) => (
            <li key={item} className="flex gap-2">
              <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">Réservé au dirigeant</p>
          <ul className="space-y-1.5" aria-label="Réservé au dirigeant">
            {ACCOUNTANT_CANNOT.map((item) => (
              <li key={item} className="text-muted-foreground flex gap-2">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Sections of a company where the accountant meets the limits of the role. */
const PAGE_HINTS: Record<string, string> = {
  banking:
    "En tant qu'expert-comptable, vous consultez les comptes et rapprochez les opérations ; connecter, modifier ou supprimer une banque est réservé au dirigeant de la société.",
  informations:
    'Vous consultez les informations de la société ; seul son dirigeant peut les modifier.',
  members:
    "Vous êtes membre de cette société avec le rôle Comptable, à côté de son dirigeant, administrateur de la société. Seul l'administrateur de l'instance peut ajouter ou retirer des membres.",
}

/** The section of a company page ("banking" in /atelier-lumen-k3x9ab/banking/connect), or null. */
export function companySectionOf(pathname: string, companyId: string | undefined): string | null {
  if (!companyId) return null
  const [first, section] = pathname.split('/').filter(Boolean)
  return first === companyId ? section ?? null : null
}

/**
 * Second line of the banner of the accountant persona on the pages whose
 * actions the role refuses (bank connections, company information,
 * members): Kledg disables those actions with the reason; the banner says
 * in one line what the persona can do there and who can do the rest.
 */
export function AccountantPageHint() {
  const pathname = usePathname()
  const params = useParams<{ companyId?: string }>()
  const section = companySectionOf(pathname ?? '', params?.companyId)
  const hint = section ? PAGE_HINTS[section] : undefined
  if (!hint) return null
  return (
    <p className="text-foreground flex basis-full items-start justify-center gap-1.5" role="note">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{hint}</span>
    </p>
  )
}
