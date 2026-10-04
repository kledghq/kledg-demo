import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

import { ResetDemoButton } from '../reset-demo-button'
import { SwitchPersonaButton } from '../switch-persona-button'

const assign = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  assign.mockReset()
  toastError.mockReset()
})

describe('demo rebuild dialogs', () => {
  it('changing persona: the three personas, the current one marked, what is kept and erased, a neutral button', async () => {
    let finish: (value: { ok: true; redirectTo: string }) => void = () => {}
    const switchPersona = vi.fn((persona: string) => {
      void persona
      return new Promise<{ ok: true; redirectTo: string }>((resolve) => (finish = resolve))
    })
    vi.stubGlobal('location', { ...window.location, assign })
    render(<SwitchPersonaButton current="director" switchPersona={switchPersona} />)
    fireEvent.click(screen.getByRole('button', { name: 'Changer de profil' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Changer de profil ?' })).toBeInTheDocument()
    const radios = within(dialog).getAllByRole('radio')
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual([
      expect.stringContaining('Dirigeanten cours'),
      expect.stringContaining('Expert-comptable'),
      expect.stringContaining('Administrateur'),
    ])
    expect(within(dialog).getByRole('radio', { name: /Dirigeant/ })).toBeDisabled()
    // The first other persona is selected, with what it offers.
    expect(within(dialog).getByRole('list', { name: 'Expert-comptable' })).toHaveTextContent('brouillon à valider')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Administrateur/ }))
    expect(within(dialog).getByRole('list', { name: 'Administrateur' })).toHaveTextContent('mises à jour')
    expect(within(dialog).getByRole('list', { name: 'Conservé' })).toHaveTextContent('Votre session')
    expect(within(dialog).getByRole('list', { name: 'Effacé' })).toHaveTextContent('Relevés importés')
    // Cancel first (initial focus), then a neutral confirm button: switching is not dangerous.
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toHaveFocus()
    const confirm = within(dialog).getByRole('button', { name: 'Passer en administrateur' })
    expect(confirm.className).not.toContain('bg-destructive')

    fireEvent.click(confirm)
    expect(switchPersona).toHaveBeenCalledWith('admin')
    const progress = await within(dialog).findByRole('list', { name: 'Préparation de votre démo' })
    expect(within(progress).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Suppression de vos données',
      'Création des sociétés',
      'Prêt',
    ])
    expect(within(dialog).queryByRole('button', { name: 'Annuler' })).toBeNull()
    finish({ ok: true, redirectTo: '/atelier-lumen-k3x9ab' })
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/atelier-lumen-k3x9ab'))
    expect(within(progress).getByText('Prêt').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('reset: destructive button with a calm label, an error closes the dialog with a toast', async () => {
    const reset = vi.fn(async () => ({ ok: false as const, error: 'Trop de réinitialisations' }))
    render(<ResetDemoButton reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser ma démo' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Réinitialiser votre démo ?' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('list', { name: /Dirigeant|Expert-comptable/ })).toBeNull()
    const confirm = within(dialog).getByRole('button', { name: 'Réinitialiser' })
    expect(confirm.className).toContain('bg-destructive')
    fireEvent.click(confirm)
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Trop de réinitialisations'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })
})
