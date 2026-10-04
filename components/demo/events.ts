/**
 * Window events between the demo components. The samples panel floats above
 * dialogs (it serves the statement import dialog), so a demo dialog of its
 * own announces itself and the panel steps aside while it is open.
 */
export const DEMO_DIALOG_EVENT = 'kledg-demo:dialog'

export interface DemoDialogState {
  open: boolean
}

export function announceDemoDialog(open: boolean): void {
  window.dispatchEvent(new CustomEvent<DemoDialogState>(DEMO_DIALOG_EVENT, { detail: { open } }))
}
