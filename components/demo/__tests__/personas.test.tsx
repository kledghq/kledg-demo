import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/atelier-lumen-k3x9ab/banking', companyId: 'atelier-lumen-k3x9ab' as string | undefined }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: nav.companyId }),
  usePathname: () => nav.pathname,
}))

import { DemoLoginCard } from '../demo-login-card'
import { AccountantPageHint, companySectionOf } from '../accountant-guide'
import { BannerDetails } from '../banner-details'

describe('demo login card personas', () => {
  it('offers the two personas and enters with the one chosen', async () => {
    const enter = vi.fn(async () => ({ ok: false as const, error: 'Refus de test' }))
    render(<DemoLoginCard redirectTo="/" enter={enter} />)
    const director = screen.getByRole('radio', { name: /Dirigeant/ })
    const accountant = screen.getByRole('radio', { name: /Expert-comptable/ })
    expect(director).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/quatre sociétés clientes/)).toBeInTheDocument()

    fireEvent.click(accountant)
    expect(accountant).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Entrer dans la démo' }))
    await waitFor(() => expect(enter).toHaveBeenCalledWith('/', 'accountant'))
    expect(await screen.findByText('Refus de test')).toBeInTheDocument()
  })

  it('sends a visitor back to the current sandbox, and warns before recreating it in the other persona', () => {
    render(<DemoLoginCard redirectTo="/" enter={vi.fn()} current="accountant" />)
    expect(screen.getByRole('radio', { name: /Expert-comptable/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Retourner à ma démo' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Dirigeant/ }))
    expect(screen.getByRole('button', { name: 'Recréer ma démo en tant que dirigeant' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('vos modifications seront effacées')
  })
})

describe('accountant hints on the pages the role restricts', () => {
  it('reads the company section from the path', () => {
    expect(companySectionOf('/atelier-lumen-k3x9ab/banking/connect', 'atelier-lumen-k3x9ab')).toBe('banking')
    expect(companySectionOf('/atelier-lumen-k3x9ab', 'atelier-lumen-k3x9ab')).toBeNull()
    expect(companySectionOf('/settings/api-keys', undefined)).toBeNull()
  })

  it('explains bank connections, company information and members, nothing elsewhere', () => {
    nav.pathname = '/atelier-lumen-k3x9ab/banking/connect'
    const { rerender, container } = render(<AccountantPageHint />)
    expect(screen.getByRole('note')).toHaveTextContent('réservé au dirigeant')
    nav.pathname = '/atelier-lumen-k3x9ab/informations'
    rerender(<AccountantPageHint />)
    expect(screen.getByRole('note')).toHaveTextContent('seul son dirigeant peut les modifier')
    nav.pathname = '/atelier-lumen-k3x9ab/members'
    rerender(<AccountantPageHint />)
    expect(screen.getByRole('note')).toHaveTextContent('rôle Comptable')
    nav.pathname = '/atelier-lumen-k3x9ab/entries'
    rerender(<AccountantPageHint />)
    expect(container.innerHTML).toBe('')
  })
})

describe('compact banner on narrow screens', () => {
  it('folds the details behind "Détails"', () => {
    render(
      <BannerDetails>
        <span>Réinitialisée après 24 h</span>
      </BannerDetails>,
    )
    const toggle = screen.getByRole('button', { name: 'Détails' })
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Hidden on small screens; md:contents puts it back inline from md up.
    expect(details.className).toMatch(/(^| )hidden( |$)/)
    expect(details.className).toContain('md:contents')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(details.className).not.toMatch(/(^| )hidden( |$)/)
  })
})
