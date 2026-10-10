import { configure } from '@testing-library/dom'

// The runners of the CI are slow (Windows above all): what a component test waits for (`findBy…`, `waitFor`) gets longer there than on a developer's machine.
// (Also with the whole suite running at once on a developer's machine: DiffView and HexEditView failed now and then with one second.)
configure({ asyncUtilTimeout: process.env.CI ? 8000 : 5000 })

// happy-dom prints a frame it was told not to load as an error straight to stderr. The workbench tests open many snapshots
// (each an iframe whose page is the main process's business, not the test's), so that one message is dropped.
const write = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => (String(chunk).includes('Iframe page loading is disabled') ? true : (write as (...a: unknown[]) => boolean)(chunk, ...rest))) as typeof process.stderr.write

// A browser fires `selectionchange` as a queued task, after the code that changed the selection has returned, and not at all when the selection
// is set to where it already is. happy-dom fires it at once, inside `Selection.collapse`, and every time: CodeMirror, which sets the selection in the
// middle of its own update, heard about it while updating and threw "Calls to EditorView.update are not allowed while an update is in progress"
// (an unhandled rejection that vitest blamed on EditView.test.tsx). Here one event is delivered later, as in a browser, and only if the selection moved.
if (typeof document !== 'undefined') {
  const dispatch = document.dispatchEvent.bind(document)
  const where = () => {
    const s = document.getSelection()
    return s ? [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset] : []
  }
  let seen = where()
  let queued = false
  document.dispatchEvent = (event: Event) => {
    if (event.type !== 'selectionchange') return dispatch(event)
    if (queued) return true
    queued = true
    setTimeout(() => {
      queued = false
      const now = where()
      if (now.every((v, i) => v === seen[i]) && now.length === seen.length) return
      seen = now
      dispatch(event)
    }, 0)
    return true
  }
}
