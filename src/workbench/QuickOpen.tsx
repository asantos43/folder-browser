import type { FileListResult } from '@core/api.ts'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { Translate } from '@/i18n/index.ts'
import { basename } from '@/lib/format.ts'
import { fuzzyScore } from '@/lib/fuzzy.ts'
import { fileIcon } from '@/lib/icons.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import { fileKey, isSnapshotTab, snapshotKey, type Workspace } from '@/state/workspace.ts'
import { MENUS, type Commands } from './commands.ts'
import { snapshotTitle } from './tabInfo.ts'

interface Item {
  id: string
  label: string
  /** Where it is: the snapshot and the folder, or the menu a command belongs to. */
  description: string
  icon: string
  shortcut?: string
  run: () => void
}

const MAX_ITEMS = 100

/** Every command of the menus that can run now, as "Menu: Command", and the colour themes. */
function commandItems(t: Translate, commands: Commands, setTheme: Commands['setTheme']): Item[] {
  const items: Item[] = []
  const visit = (menu: string, entries: MenuEntry[], prefix = '') => {
    for (const entry of entries) {
      if ('separator' in entry || entry.disabled) continue
      if (entry.submenu) visit(menu, entry.submenu, `${prefix}${entry.label}: `)
      else if (entry.run) items.push({ id: `${menu}:${prefix}${entry.id}`, label: `${prefix}${entry.label}`, description: menu, icon: 'terminal', shortcut: entry.shortcut, run: entry.run })
    }
  }
  for (const menu of MENUS) visit(t(menu.label), menu.entries(t, commands))
  // The zoom of the tab on screen is not in the menus (nothing zooms the whole application), but it is a command.
  if (commands.canZoom) {
    for (const [id, label, run] of [['zoomIn', t('menu.zoomIn'), commands.zoomIn], ['zoomOut', t('menu.zoomOut'), commands.zoomOut], ['zoomReset', t('menu.resetZoom'), commands.zoomReset]] as const) items.push({ id: `view:${id}`, label, description: t('menu.view'), icon: 'zoom-in', run })
  }
  for (const [name, value] of [['Dark+', 'dark'], ['Light+', 'light']] as const) items.push({ id: `theme:${value}`, label: t('quickOpen.theme', { name }), description: t('menu.view'), icon: 'symbol-color', run: () => setTheme(value) })
  return items
}

/**
 * VS Code's quick open, from the box in the title bar (and Ctrl+E): type part of a name to go to a file of any open folder, ZIP file or snapshot, `>` for
 * the commands of the menus (Ctrl+Shift+P opens it with the `>` already typed). With nothing typed it lists the tabs, the latest first.
 */
export function QuickOpen({ start, ws, commands, loadFiles, onOpen, onClose }: { start: 'files' | 'commands'; ws: Workspace; commands: Commands; /** The files of a folder or ZIP file that is open (the main process walks it). */ loadFiles: (rootId: string) => Promise<FileListResult>; onOpen: (snapshotId: string, path: string | undefined) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState(start === 'commands' ? '>' : '')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])

  const asCommands = query.startsWith('>')
  const text = asCommands ? query.slice(1).trim() : query.trim()

  // The files of every folder and ZIP file that is open, asked when the box opens (a folder of many files takes a moment; what is typed meanwhile finds the rest).
  const roots = useMemo(() => Object.values(ws.roots).filter((root) => !root.trash), [ws.roots])
  const [indexed, setIndexed] = useState<Record<string, { paths: string[]; truncated: boolean } | 'failed'>>({})
  useEffect(() => {
    let alive = true
    for (const root of roots) {
      loadFiles(root.id).then(
        (result) => alive && setIndexed((all) => ({ ...all, [root.id]: 'paths' in result ? result : 'failed' })),
        () => alive && setIndexed((all) => ({ ...all, [root.id]: 'failed' })),
      )
    }
    return () => {
      alive = false
    }
  }, [roots, loadFiles])
  const waiting = roots.some((root) => indexed[root.id] === undefined)
  const cut = roots.some((root) => {
    const found = indexed[root.id]
    return found !== undefined && found !== 'failed' && found.truncated
  })

  const files = useMemo(() => {
    const all: Item[] = []
    for (const root of roots) {
      const found = indexed[root.id]
      if (!found || found === 'failed') continue
      for (const file of found.paths) {
        const slash = file.lastIndexOf('/')
        all.push({ id: fileKey(root.id, file), label: file.slice(slash + 1), description: `${root.name}${slash > 0 ? ` › ${file.slice(0, slash)}` : ''}`, icon: fileIcon(undefined, file), run: () => onOpen(root.id, file) })
      }
    }
    for (const snapshot of Object.values(ws.snapshots)) {
      const title = snapshotTitle(ws, snapshot.id)
      all.push({ id: snapshotKey(snapshot.id), label: title, description: t('quickOpen.snapshot'), icon: 'browser', run: () => onOpen(snapshot.id, undefined) })
      for (const file of snapshot.files) {
        if (file.path === 'mimetype') continue
        const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
        all.push({ id: fileKey(snapshot.id, file.path), label: basename(file.path), description: `${title}${folder ? ` › ${folder}` : ''}`, icon: fileIcon(file.mediaType, file.path), run: () => onOpen(snapshot.id, file.path) })
      }
    }
    return all
  }, [ws, t, onOpen, roots, indexed])

  const items = useMemo(() => {
    if (asCommands) {
      const all = commandItems(t, commands, commands.setTheme)
      return (text ? all.map((i) => [i, fuzzyScore(text, i.label)] as const).filter(([, s]) => s !== null).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([i]) => i) : all).slice(0, MAX_ITEMS)
    }
    if (!text) {
      // The tabs, the latest first: what the user is most likely going back to.
      const byKey = new Map(files.map((i) => [i.id, i]))
      return [...new Set([...ws.recent, ...ws.tabs.map((tab) => tab.key)])]
        .map((key) => byKey.get(key) ?? (() => {
          const tab = ws.tabs.find((x) => x.key === key)
          return tab && tab.path !== undefined && !isSnapshotTab(tab) ? ({ id: key, label: basename(tab.path), description: snapshotTitle(ws, tab.snapshotId), icon: fileIcon(undefined, tab.path), run: () => onOpen(tab.snapshotId, tab.path) } satisfies Item) : undefined
        })())
        .filter((i): i is Item => Boolean(i))
        .slice(0, MAX_ITEMS)
    }
    return files
      .map((i) => [i, Math.max(fuzzyScore(text, i.label) ?? -1, (fuzzyScore(text, i.description) ?? -1) - 200)] as const)
      .filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ITEMS)
      .map(([i]) => i)
  }, [asCommands, text, files, commands, t, ws, onOpen])

  // (Effects that return nothing: a value returned from one is taken for its clean-up.)
  useEffect(() => {
    setAt(0)
  }, [query])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [at, items])

  const choose = (item: Item | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') setAt((i) => Math.min(items.length - 1, i + 1))
    else if (event.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1))
    else if (event.key === 'Home') setAt(0)
    else if (event.key === 'End') setAt(Math.max(0, items.length - 1))
    else if (event.key === 'Enter') choose(items[at])
    else if (event.key === 'Escape') onClose()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="fixed inset-0 z-40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t('quickOpen.label')} className="mx-auto mt-[38px] w-[min(600px,calc(100vw-32px))] overflow-hidden rounded-md border border-widget-border bg-widget text-[13px] text-fg shadow-[0_0_8px_2px_var(--vscode-widget-shadow)]">
        <div className="p-1.5">
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-open-list"
            aria-activedescendant={items[at] ? `quick-open-${at}` : undefined}
            aria-label={t('quickOpen.label')}
            placeholder={t('quickOpen.placeholder')}
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-[26px] w-full rounded-sm border border-group-border bg-editor px-2 text-fg outline-none placeholder:text-fg-muted focus:border-focus"
          />
        </div>
        <div ref={list} id="quick-open-list" role="listbox" aria-label={t('quickOpen.label')} className="max-h-[300px] overflow-auto pb-1">
          {!asCommands && !text && items.length ? <div className="px-3 pt-1 pb-0.5 text-[11px] text-fg-muted">{t('quickOpen.recent')}</div> : null}
          {items.length === 0 ? <div className="px-3 py-2 text-fg-muted">{t(waiting && !asCommands ? 'quickOpen.indexing' : 'quickOpen.none')}</div> : null}
          {items.length > 0 && !asCommands && text && waiting ? <div className="px-3 py-1 text-[11px] text-fg-muted">{t('quickOpen.indexing')}</div> : null}
          {!asCommands && text && cut ? <div className="px-3 py-1 text-[11px] text-fg-muted">{t('quickOpen.truncated')}</div> : null}
          {items.map((item, i) => (
            <div
              key={item.id}
              id={`quick-open-${i}`}
              role="option"
              aria-selected={i === at}
              onMouseMove={() => setAt(i)}
              onClick={() => choose(item)}
              className={`mx-1 flex h-[24px] cursor-pointer items-center gap-2 rounded-[3px] px-2 ${i === at ? 'bg-list-active text-list-active-fg' : ''}`}
            >
              <Icon name={item.icon} className="shrink-0 text-[16px]" />
              <span className="truncate">{item.label}</span>
              <span className={`min-w-0 flex-1 truncate text-[12px] ${i === at ? 'opacity-80' : 'text-fg-muted'}`}>{item.description}</span>
              {item.shortcut ? <span className="shrink-0 text-[12px] opacity-70">{item.shortcut}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
