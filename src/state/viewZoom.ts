/**
 * The zoom of a view that keeps its own (a picture, a PDF: with their toolbar, fit modes and a wheel that zooms around the pointer). While it is shown it registers
 * itself, so that the keys of the workbench (Ctrl+=, Ctrl+-, Ctrl+0) zoom it too.
 */
export interface ViewZoom {
  step(direction: 1 | -1): void
  reset(): void
}

let current: ViewZoom | null = null
export const viewZoom = {
  set(target: ViewZoom): () => void {
    current = target
    return () => {
      if (current === target) current = null
    }
  },
  get: (): ViewZoom | null => current,
}
