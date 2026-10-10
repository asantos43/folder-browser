// The contract between the Plugins page and the lazy plugin host (step 2.5a).
// Pure types, no Electron, no IPC, no DOM: the renderer imports these and the host will
// implement them on top of the package reader and the installed index.

/** Where the plugin came from and how much of a guarantee that is (`docs/EXTENSIONS-DESIGN.md` §5). */
export type TrustLabel =
  | 'catalog'           // From the catalog: curated and signed by the project
  | 'signed-trusted'    // Signed by a publisher you trust
  | 'signed-unknown'    // Signed, unknown publisher
  | 'repository'        // From a repository at a pinned commit
  | 'unsigned'          // No signature

/** Counts the page needs to summarise what a plugin contributes (`contributes` in the manifest). */
export interface PluginContributes {
  themes: number
  keymaps: number
  languages: number
  locales: number
  openWith: number
  commands: number
  settings: number
}

/** What the Plugins page shows about one installed plugin. */
export interface PluginSummary {
  id: string
  name: string
  version: string
  description?: string
  publisher: { id: string; name: string }
  trust: TrustLabel
  enabled: boolean
  sizeBytes: number
  contributes: PluginContributes
  /** True when the plugin ships a `main` entry that runs as code (phase 3). */
  hasCode: boolean
  /** True only for a developer-mode install (an unpacked folder watched on change). */
  developer: boolean
  /** A short message in plain words when the package reader could not produce a full summary. */
  error?: string
}

/** Removing a plugin asks whether to keep the user's settings under `plugins.<id>`. */
export interface RemoveOptions { keepSettings: boolean }

/** What `install()` returns: success, refusal (with a one-line fix), or user cancellation. */
export type InstallOutcome =
  | { ok: true; id: string; notices?: readonly { code: string; message: string }[] }
  | { ok: false; code: string; message: string }
  | { cancelled: true }

/**
 * The interface the host exposes on `window.fb.plugins` (step 2.5a). The renderer
 * reads it through `usePlugins()` and never imports `window.fb` itself.
 */
export interface PluginsApi {
  list(): Promise<PluginSummary[]>
  setEnabled(id: string, enabled: boolean): Promise<void>
  remove(id: string, opts: RemoveOptions): Promise<void>
  disableAll(): Promise<void>
  openFolder(id: string): Promise<void>
  install(): Promise<InstallOutcome>
  /** Disk paths supplied by a file drop; the host validates every selected source. */
  installPaths(paths: string[]): Promise<InstallOutcome>
  /** Subscribe to changes; the panel refreshes through this, debounced to one call per frame. */
  onChange(callback: () => void): () => void
}
