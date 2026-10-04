'use client'

/**
 * Floating "Fichiers d'exemple" panel of the demo instance (rendered by the
 * CompanyOverlay slot, components/instance/slots.tsx): sample bank
 * statements of the current company, handed to Kledg's statement import as
 * an external file source (components/features/banking/statement-drop.ts).
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Download, FileText, FolderOpen, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { plural, pluralWord } from '@/lib/utils/plural'
import { DEMO_DIALOG_EVENT, type DemoDialogState } from './events'
import {
  EXTERNAL_FILE_DRAG_TYPE,
  externalFile,
  IMPORT_DIALOG_STATE_EVENT,
  IMPORT_FILE_EVENT,
  IMPORT_FILE_PARAM,
  registerExternalFile,
  unregisterExternalFile,
  type ImportDialogState,
  type ImportFileRequest,
} from '@/components/features/banking/statement-drop'

interface SampleFile {
  format: string
  fileName: string
  label: string
  badge: string
  mimeType: string
  url: string
}

interface SamplesResponse {
  bankAccountId: string
  lines: { existing: number; new: number }
  files: SampleFile[]
}

const COLLAPSED_KEY = 'kledg-demo-samples-collapsed'

/** Collapsed unless the visitor opened it before: expanded, it covers page content on smaller screens. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) !== '0'
  } catch {
    return true
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the state is just not remembered
  }
}

/** Pages that host the statement import dialog (and its page-wide drop target). */
const IMPORT_PAGE = /\/banking(\/statements)?\/?$/

/** Only the demo sample routes of this instance are downloaded. */
export function isSampleUrl(url: string): boolean {
  return /^\/api\/demo\/samples\/[a-z0-9]+\?companyId=[A-Za-z0-9_-]+$/.test(url)
}

/** Downloads a sample file into a File for the import dialog. */
async function downloadSample(file: SampleFile): Promise<File> {
  if (!isSampleUrl(file.url)) throw new Error('Fichier d’exemple inconnu.')
  const response = await fetch(file.url)
  if (!response.ok) throw new Error('Impossible de récupérer le fichier d’exemple.')
  const blob = await response.blob()
  return new File([blob], file.fileName, { type: blob.type })
}

export function DemoSamplesPanel() {
  const params = useParams()
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const companyId = typeof params?.companyId === 'string' ? params.companyId : null
  const { isMobile } = useSidebar()
  const [data, setData] = useState<SamplesResponse | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  // Folded while the import dialog shows a preview (not remembered)
  const [dialogPreview, setDialogPreview] = useState(false)
  // Hidden while a demo dialog (reset confirmation) is open
  const [demoDialog, setDemoDialog] = useState(false)

  useEffect(() => {
    const onState = (e: Event) => setDialogPreview(Boolean((e as CustomEvent<ImportDialogState>).detail?.hasPreview))
    const onDemoDialog = (e: Event) => setDemoDialog(Boolean((e as CustomEvent<DemoDialogState>).detail?.open))
    window.addEventListener(IMPORT_DIALOG_STATE_EVENT, onState)
    window.addEventListener(DEMO_DIALOG_EVENT, onDemoDialog)
    return () => {
      window.removeEventListener(IMPORT_DIALOG_STATE_EVENT, onState)
      window.removeEventListener(DEMO_DIALOG_EVENT, onDemoDialog)
    }
  }, [])

  useEffect(() => {
    // Remembered per browser; read after mount (no localStorage on the server)
    const timer = setTimeout(() => setCollapsed(readCollapsed()), 0)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/demo/samples?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: SamplesResponse | null) => {
        if (!cancelled) setData(body)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  // Samples are offered to the import dialog under tokens, registered when
  // first used and released when the panel goes away
  const tokensRef = useRef(new Map<string, string>())
  useEffect(() => {
    const tokens = tokensRef.current
    return () => {
      tokens.forEach((token) => unregisterExternalFile(token))
      tokens.clear()
    }
  }, [])

  if (!companyId || !data || data.files.length === 0 || demoDialog) return null

  const tokenFor = (file: SampleFile): string => {
    const key = `${data.bankAccountId}|${file.url}`
    const existing = tokensRef.current.get(key)
    if (existing && externalFile(existing)) return existing
    const token = registerExternalFile({ fileName: file.fileName, bankAccountId: data.bankAccountId, load: () => downloadSample(file) })
    tokensRef.current.set(key, token)
    return token
  }

  const onImportPage = IMPORT_PAGE.test(pathname)
  const folded = collapsed || dialogPreview
  const toggle = () => {
    if (dialogPreview) {
      setDialogPreview(false)
      return
    }
    const next = !collapsed
    setCollapsed(next)
    writeCollapsed(next)
  }

  const importFile = (file: SampleFile) => {
    setSheetOpen(false)
    const token = tokenFor(file)
    const event = new CustomEvent<ImportFileRequest>(IMPORT_FILE_EVENT, { detail: { token }, cancelable: true })
    // Not cancelled: no import dialog on this page, open the statements page
    // with the file (client-side navigation keeps the registered file)
    if (window.dispatchEvent(event)) {
      const query = new URLSearchParams({ [IMPORT_FILE_PARAM]: token })
      router.push(`/${companyId}/banking/statements?${query.toString()}`)
    }
  }

  const onDragStart = (e: React.DragEvent<HTMLDivElement>, file: SampleFile) => {
    const absolute = new URL(file.url, window.location.origin).toString()
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData(EXTERNAL_FILE_DRAG_TYPE, tokenFor(file))
    e.dataTransfer.setData('text/uri-list', absolute)
    e.dataTransfer.setData('text/plain', file.fileName)
    // Chrome: dropping onto the desktop saves the file
    e.dataTransfer.setData('DownloadURL', `${file.mimeType}:${file.fileName}:${absolute}`)
    e.dataTransfer.setDragImage(e.currentTarget, 20, 16)
    setDragging(file.format)
  }

  const hint = onImportPage
    ? 'Glissez un fichier dans la fenêtre d’import, ou cliquez sur Importer.'
    : 'Ouvrez Banque > Relevés puis glissez un fichier, ou cliquez sur Importer.'

  const list = (
    <ul className="space-y-1.5">
      {data.files.map((file) => (
        <li key={file.format}>
          <div
            draggable={!isMobile}
            onDragStart={(e) => onDragStart(e, file)}
            onDragEnd={() => setDragging(null)}
            title={isMobile ? file.fileName : `Glissez ${file.fileName} pour l’importer`}
            data-sample-format={file.format}
            tabIndex={isMobile ? undefined : 0}
            className={cn(
              'group flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-xs transition-colors',
              !isMobile && 'cursor-grab hover:border-primary/40 hover:bg-accent active:cursor-grabbing',
              dragging === file.format && 'opacity-60',
            )}
          >
            {!isMobile && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{file.label}</div>
              <div className="truncate text-[11px] text-muted-foreground">{file.fileName}</div>
            </div>
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
              {file.badge}
            </Badge>
            <Button
              variant="ghost"
              size="xs"
              className={cn(!isMobile && 'hidden group-hover:inline-flex group-focus-within:inline-flex')}
              onClick={() => importFile(file)}
            >
              Importer
            </Button>
            <Button variant="ghost" size="icon-xs" className="shrink-0" asChild>
              <a href={file.url} download={file.fileName} title={`Télécharger ${file.fileName}`} aria-label={`Télécharger ${file.fileName}`}>
                <Download className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )

  const summary = `${plural(data.lines.existing, 'opération')} déjà sur le compte (${pluralWord(data.lines.existing, 'doublon probable', 'doublons probables')}) et ${plural(data.lines.new, 'nouvelle')}.`

  if (isMobile) {
    return (
      <div data-instance-overlay data-demo-samples className="pointer-events-auto fixed right-4 bottom-4 z-[60]">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline" className="shadow-md">
              <FolderOpen className="h-4 w-4" />
              Exemples
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" data-instance-overlay data-demo-samples className="max-h-[80vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Fichiers d’exemple</SheetTitle>
              <SheetDescription>Cliquez sur Importer pour charger un relevé dans la fenêtre d’import. {summary}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">{list}</div>
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  // Bottom right: the sidebar's account menu opens at the bottom left.
  return (
    <aside
      data-instance-overlay
      data-demo-samples
      aria-label="Fichiers d’exemple"
      className="pointer-events-auto fixed right-4 bottom-4 z-[60] w-[22rem] max-w-[calc(100vw-var(--sidebar-width)-2rem)] rounded-lg border bg-popover text-popover-foreground shadow-lg"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!folded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="flex-1">Fichiers d’exemple</span>
        {folded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {!folded && (
        <div className="space-y-2 border-t px-3 pt-2 pb-3">
          <p className="text-xs text-muted-foreground">{hint}</p>
          {list}
          <p className="text-[11px] text-muted-foreground">{summary}</p>
        </div>
      )}
    </aside>
  )
}
