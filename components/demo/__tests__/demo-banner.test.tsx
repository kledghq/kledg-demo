import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// The banner's database work (persona lookup, activity) is out of scope here.
vi.mock('@/lib/demo/sandbox/membership', () => ({ sandboxPersona: vi.fn(async () => 'director') }))
vi.mock('@/lib/demo/sandbox/activity', () => ({ touchSandbox: vi.fn(async () => {}) }))
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/', useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { DemoBanner } from '../demo-banner'

const WAITLIST = 'https://www.kledg.com/fr/waitlist?from=demo'
const actions = { reset: vi.fn(), switchPersona: vi.fn() }

async function renderBanner(email: string) {
  render(await DemoBanner({ user: { id: 'u1', email, role: null }, ...actions }))
}

describe('demo banner links to the website', () => {
  it('offers the hosted waitlist next to the install link in the plain demo', async () => {
    await renderBanner('demo@kledg.com')
    expect(screen.getByRole('link', { name: 'Installez votre propre instance.' })).toHaveAttribute('href', 'https://www.kledg.com')
    expect(screen.getByRole('link', { name: /rejoindre la liste d’attente/ })).toHaveAttribute('href', WAITLIST)
  })

  it('puts the waitlist link under "Détails" in a sandbox, with the install link', async () => {
    await renderBanner('visiteur-k3x9ab@demo.kledg.com')
    const toggle = screen.getByRole('button', { name: 'Détails' })
    fireEvent.click(toggle)
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)!
    const link = screen.getByRole('link', { name: /rejoindre la liste d’attente/ })
    expect(link).toHaveAttribute('href', WAITLIST)
    // French typography: a non-breaking space before the colon.
    expect(link.textContent).toBe('Ou attendez la version hébergée\u00a0: rejoindre la liste d’attente')
    expect(details).toContainElement(link)
    expect(details).toContainElement(screen.getByRole('link', { name: 'Installez votre propre instance.' }))
  })
})
