/**
 * The startup-guard rule for the plugin host: keeps `core/plugins/`, `electron/`,
 * the install code and the IPC out of every production startup module except the
 * two files that are the panel's own UI surface (`src/plugins/usePlugins.tsx`
 * with its context and hook, and `src/views/PluginsPanel.tsx` loaded via
 * `React.lazy`). Extracted as a pure function so the test can apply it to a
 * fake file list and exercise every branch.
 */

export interface FileRecord { path: string; source: string }

export type ImportKind = 'static' | 'dynamic' | 'type'

export interface Import { specifier: string; kind: ImportKind; line: number }

/** Allowed importers: the panel UI surface (`src/plugins/` + `PluginsPanel.tsx`). */
const ALLOWED_PLUGIN_IMPORTERS = ['src/plugins/', 'src/views/PluginsPanel.tsx']

/** A specifier that points at the plugin host or one of its packages. */
const PLUGIN_HOST_PATH = /(?:^|\/)plugins(?:\/|$)/

/** A specifier that points at the panel UI; must be reached only through `lazy()`. */
const PANEL_PATH = /PluginsPanel/

/**
 * Every `import`/`export … from`/`import()`/`require()` call in `source`, classified
 * by kind. The classification is by the characters preceding the specifier in the
 * source (a small window): `import type` is erased by `tsc`; `import('spec')` is a
 * dynamic import that loads the module on demand.
 */
export function classifyImports(source: string): Import[] {
  const out: Import[] = []
  const re = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const specifier = m[1]
    if (!specifier) continue
    const before = source.slice(Math.max(0, m.index - 100), m.index + 20)
    const tail = before.slice(Math.max(0, before.lastIndexOf('import')))
    let kind: ImportKind
    if (/\bimport\s+type\b/.test(tail)) kind = 'type'
    else if (/\bimport\s*\(/.test(tail)) kind = 'dynamic'
    else kind = 'static'
    out.push({ specifier, kind, line: source.slice(0, m.index).split('\n').length })
  }
  return out
}

function isTest(path: string): boolean {
  return /\.(?:test|spec)\./.test(path)
}

function isAllowedImporter(path: string): boolean {
  return ALLOWED_PLUGIN_IMPORTERS.some(prefix => path === prefix || path.startsWith(prefix))
}

/**
 * Returns the list of violations against the rule. Empty means the rule holds.
 * A violation is reported as `"<path>: <reason>"`.
 */
export function violations(files: FileRecord[]): string[] {
  const out: string[] = []
  for (const { path, source } of files) {
    if (isTest(path)) continue
    if (path.startsWith('core/plugins/')) continue
    const imports = classifyImports(source)
    for (const { specifier, kind } of imports) {
      if (PLUGIN_HOST_PATH.test(specifier) && kind !== 'type') {
        // `import type` is erased by the compiler. Anything else (static, dynamic, require)
        // reaches the host at run time: only the panel UI may do it, and only for the
        // pure contract (`summary.ts`), never for the package reader, the settings or the IPC.
        if (!isAllowedImporter(path)) {
          out.push(`${path}: ${kind} import of '${specifier}' (only the panel UI may import plugins)`)
        } else if (!/(?:^|\/)summary(?:\.ts)?$/.test(specifier) && !/^(?:@\/|\.\/|\.\.\/).*plugins\/usePlugins/.test(specifier)) {
          out.push(`${path}: ${kind} import of '${specifier}' (the panel UI may import only the contract at run time)`)
        }
      }
      if (PANEL_PATH.test(specifier)) {
        if (kind === 'static' && path !== 'src/views/PluginsPanel.tsx') {
          out.push(`${path}: static import of '${specifier}' (the panel UI is reached only via lazy())`)
        }
      }
    }
  }
  return out
}