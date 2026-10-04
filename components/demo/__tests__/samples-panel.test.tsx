import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/atelier-lumen/banking/statements', push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'atelier-lumen' }),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}))

import { DemoSamplesPanel, isSampleUrl } from '../samples-panel'
import { CompanyOverlay } from '@/components/instance/slots'
import { SidebarProvider } from '@/components/ui/sidebar'
import {
  droppedFile,
  EXTERNAL_FILE_DRAG_TYPE,
  externalFile,
  IMPORT_FILE_EVENT,
  type ImportFileRequest,
} from '@/components/features/banking/statement-drop'

const LIST = {
  bankAccountId: 'acc-1',
  lines: { existing: 5, new: 5 },
  files: [
    { format: 'csv', fileName: 'releve-atelier-lumen-20261003.csv', label: 'Relevé CSV', badge: 'CSV', mimeType: 'text/csv', url: '/api/demo/samples/csv?companyId=c1' },
    { format: 'ofx', fileName: 'releve-atelier-lumen-20261003.ofx', label: 'Relevé OFX', badge: 'OFX', mimeType: 'application/x-ofx', url: '/api/demo/samples/ofx?companyId=c1' },
  ],
}

function renderPanel() {
  return render(
    <SidebarProvider>
      <DemoSamplesPanel />
    </SidebarProvider>,
  )
}

describe('DemoSamplesPanel', () => {
  const previous = process.env.KLEDG_DEMO_MODE

  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    })
    // Expanded, as after a visitor opened it once (the panel starts collapsed).
    store.set('kledg-demo-samples-collapsed', '0')
    nav.pathname = '/atelier-lumen/banking/statements'
    nav.push.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(LIST), { status: 200 })))
    // useIsMobile reads matchMedia
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  })

  afterEach(() => {
    process.env.KLEDG_DEMO_MODE = previous
    vi.unstubAllGlobals()
  })

  const user = { id: 'u1', email: 'demo@kledg.com', role: 'admin' }

  it('is rendered by the CompanyOverlay slot in demo mode only', () => {
    process.env.KLEDG_DEMO_MODE = 'false'
    expect(CompanyOverlay({ user })).toBeNull()
    delete process.env.KLEDG_DEMO_MODE
    expect(CompanyOverlay({ user })).toBeNull()
    process.env.KLEDG_DEMO_MODE = 'true'
    expect(CompanyOverlay({ user })?.type).toBe(DemoSamplesPanel)
  })

  it('only downloads the demo sample routes', () => {
    expect(isSampleUrl('/api/demo/samples/csv?companyId=c1')).toBe(true)
    expect(isSampleUrl('/api/companies')).toBe(false)
    expect(isSampleUrl('https://evil.example/api/demo/samples/csv?companyId=c1')).toBe(false)
  })

  it('starts collapsed for a new visitor so it does not cover the page', async () => {
    window.localStorage.removeItem('kledg-demo-samples-collapsed')
    renderPanel()
    const toggle = await screen.findByRole('button', { name: /Fichiers d’exemple/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Relevé OFX')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(await screen.findByText('Relevé OFX')).toBeInTheDocument()
    expect(window.localStorage.getItem('kledg-demo-samples-collapsed')).toBe('0')
  })

  it('lists the sample files with the drag hint and remembers when it is collapsed', async () => {
    renderPanel()
    expect(await screen.findByText('Relevé OFX')).toBeInTheDocument()
    expect(screen.getByText('Glissez un fichier dans la fenêtre d’import, ou cliquez sur Importer.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/demo/samples?companyId=atelier-lumen')

    fireEvent.click(screen.getByRole('button', { name: /Fichiers d’exemple/ }))
    expect(screen.queryByText('Relevé OFX')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('kledg-demo-samples-collapsed')).toBe('1')
  })

  it('points to the statements page on pages without import', async () => {
    nav.pathname = '/atelier-lumen/entries'
    renderPanel()
    expect(await screen.findByText('Ouvrez Banque > Relevés puis glissez un fichier, ou cliquez sur Importer.')).toBeInTheDocument()
  })

  it('drags a registered file token (the dialog downloads the sample) and a DownloadURL', async () => {
    renderPanel()
    const chip = (await screen.findByText('Relevé CSV')).closest('[draggable]') as HTMLElement
    expect(chip).toHaveAttribute('draggable', 'true')
    const data: Record<string, string> = {}
    const dataTransfer = { setData: (type: string, value: string) => (data[type] = value), setDragImage: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(chip, { dataTransfer })
    const token = data[EXTERNAL_FILE_DRAG_TYPE]
    expect(externalFile(token)).toMatchObject({ fileName: LIST.files[0].fileName, bankAccountId: 'acc-1' })
    expect(data.DownloadURL).toBe(`text/csv:${LIST.files[0].fileName}:${window.location.origin}${LIST.files[0].url}`)

    vi.mocked(fetch).mockResolvedValueOnce(new Response('Date;Montant', { status: 200 }))
    const drop = { types: [EXTERNAL_FILE_DRAG_TYPE], files: [], getData: () => token } as unknown as DataTransfer
    const dropped = await droppedFile(drop)
    expect(fetch).toHaveBeenLastCalledWith(LIST.files[0].url)
    expect(dropped?.file.name).toBe(LIST.files[0].fileName)
    expect(dropped?.bankAccountId).toBe('acc-1')
  })

  it('Importer hands the file to the dialog of the page, or opens the statements page', async () => {
    renderPanel()
    await screen.findByText('Relevé OFX')
    const handled = vi.fn((e: Event) => e.preventDefault())
    window.addEventListener(IMPORT_FILE_EVENT, handled)
    fireEvent.click(screen.getAllByRole('button', { name: 'Importer' })[1])
    expect(handled).toHaveBeenCalledTimes(1)
    const { token } = (handled.mock.calls[0][0] as CustomEvent<ImportFileRequest>).detail
    expect(externalFile(token)).toMatchObject({ fileName: LIST.files[1].fileName, bankAccountId: 'acc-1' })
    expect(nav.push).not.toHaveBeenCalled()
    window.removeEventListener(IMPORT_FILE_EVENT, handled)

    fireEvent.click(screen.getAllByRole('button', { name: 'Importer' })[0])
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1))
    const target = new URL(nav.push.mock.calls[0][0] as string, 'http://x')
    expect(target.pathname).toBe('/atelier-lumen/banking/statements')
    expect(externalFile(target.searchParams.get('importFile'))).toMatchObject({ fileName: LIST.files[0].fileName, bankAccountId: 'acc-1' })
  })
})
