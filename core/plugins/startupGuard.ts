/**
 * The startup-guard rule for the plugin host: keeps `core/plugins/`, `electron/`,
 * the install code and the IPC out of every production startup module except the
 * two files that are the panel's own UI surface (`src/plugins/usePlugins.tsx`
 * with its context and hook, and `src/views/PluginsPanel.tsx` loaded via
 * `React.lazy`). Extracted as a pure function so the test can apply it to a
 * fake file list and exercise every branch.
 * The workbench and the exact KeyboardPanel may also eagerly read the small renderer contribution store;
 * that store is guarded separately so it cannot pull the runtime into startup.
 */

import { posix } from 'node:path'

export interface FileRecord { path: string; source: string }

export type ImportKind = 'static' | 'dynamic' | 'type' | 'require'

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
    if (/^require\b/.test(m[0])) kind = 'require'
    else if (/\bimport\s+type\b/.test(tail)) kind = 'type'
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

function importTarget(path: string, specifier: string): string {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`
  if (specifier.startsWith('@core/')) return `core/${specifier.slice(6)}`
  return specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(path), specifier)) : specifier
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
      const target = importTarget(path, specifier)
      // The eagerly read store has only chord/when helpers and erased types.
      // Check all specifiers, including './runtime.ts' (which lacks '/plugins/').
      if (path === 'src/plugins/contributions.ts') {
        if (kind !== 'type' && !['core/keys/chord.ts', 'core/commands/when.ts'].includes(target)) {
          out.push(`${path}: ${kind} import of '${specifier}' (contribution store may import only chord/when helpers at run time)`)
        }
        continue
      }
      // Exact store, within the workbench or the exact KeyboardPanel; other plugin modules stay lazy.
      if ((path.startsWith('src/workbench/') || path === 'src/views/KeyboardPanel.tsx') && target === 'src/plugins/contributions.ts' && kind === 'static') continue
      if (target === 'src/plugins/contributions.ts' && kind !== 'type' && path !== 'src/plugins/runtime.ts') {
        out.push(`${path}: ${kind} import of '${specifier}' (only the workbench and KeyboardPanel may statically import the contribution store)`)
        continue
      }
      // Authorized IPC and post-window startup dynamically reach the lazy shell.
      // Only the shell may compose the four exact runtime dependencies below.
      if (/(?:^|\/)plugins-host(?:\.ts)?$/.test(specifier) && kind !== 'type') {
        if (path !== 'electron/main.ts' || kind !== 'dynamic') out.push(`${path}: eager or unauthorized plugin shell import`)
      }
      if (PLUGIN_HOST_PATH.test(specifier) && kind !== 'type') {
        if (path === 'electron/plugins-host.ts' && ['../core/plugins/host.ts', '../core/plugins/activation.ts', '../core/plugins/generation.ts', '../core/plugins/executables.ts'].includes(specifier)) continue
        // The renderer runtime is loaded by `src/main.tsx` through a dynamic
        // `import('./plugins/runtime.ts')` after the first render; the runtime
        // itself never imports the host (it only feeds renderer registries).
        if (path === 'src/main.tsx' && /^(?:\.\/|\.\.\/)plugins\/runtime(?:\.ts)?$/.test(specifier) && kind === 'dynamic') continue
        if (path === 'src/plugins/runtime.ts') continue
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
