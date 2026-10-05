import { ancestors, buildTree, type TreeNode } from '@core/tree.ts'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { fileIcon } from '@/lib/icons.ts'
import type { SnapshotInfo } from '@core/snapshots.ts'

interface Row {
  node: TreeNode
  depth: number
  parent: string | null
}

/** The rows that are visible: every folder that is open shows its children. */
function visibleRows(nodes: TreeNode[], open: ReadonlySet<string>, depth = 0, parent: string | null = null): Row[] {
  return nodes.flatMap((node) => [{ node, depth, parent }, ...(node.folder && open.has(node.path) ? visibleRows(node.children, open, depth + 1, node.path) : [])])
}

/**
 * The files of a snapshot as a tree, in VS Code's Explorer style: a click opens a preview tab, a double click (or Enter) keeps
 * it, arrows move and open, typing jumps to a name, and the context menu offers Open, Open With… (a system chooser for the application) and Save As for every file.
 */
export function FileTree({ snapshot, activePath, onOpen, onOpenWith, onSave, onCopy }: { snapshot: SnapshotInfo; activePath: string | undefined; onOpen: (path: string, keep: boolean) => void; onOpenWith: (path: string) => void; onSave: (path: string) => void; onCopy: (text: string) => void }) {
  const { t } = useI18n()
  const tree = useMemo(() => buildTree(snapshot.files), [snapshot])
  const types = useMemo(() => new Map(snapshot.files.map((f) => [f.path, f.mediaType])), [snapshot])
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const root = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => visibleRows(tree, open), [tree, open])

  // The file of the active tab is always visible in the tree.
  useEffect(() => {
    if (activePath) setOpen((current) => (ancestors(activePath).every((p) => current.has(p)) ? current : new Set([...current, ...ancestors(activePath)])))
  }, [activePath])

  const toggle = (path: string, force?: boolean) =>
    setOpen((current) => {
      const next = new Set(current)
      if (force ?? !next.has(path)) next.add(path)
      else next.delete(path)
      return next
    })

  const focusRow = (path: string) => {
    setFocused(path)
    root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const at = rows.findIndex((r) => r.node.path === (focused ?? rows[0]?.node.path))
    const row = rows[at]
    if (!row) return
    const go = (i: number) => rows[i] && focusRow(rows[i].node.path)
    switch (event.key) {
      case 'ArrowDown': go(Math.min(rows.length - 1, at + 1)); break
      case 'ArrowUp': go(Math.max(0, at - 1)); break
      case 'Home': go(0); break
      case 'End': go(rows.length - 1); break
      case 'ArrowRight':
        if (row.node.folder) {
          if (open.has(row.node.path)) go(at + 1)
          else toggle(row.node.path, true)
        }
        break
      case 'ArrowLeft':
        if (row.node.folder && open.has(row.node.path)) toggle(row.node.path, false)
        else if (row.parent) focusRow(row.parent)
        break
      case 'Enter':
        if (row.node.folder) toggle(row.node.path)
        else onOpen(row.node.path, true)
        break
      case ' ':
        if (row.node.folder) toggle(row.node.path)
        else onOpen(row.node.path, false)
        break
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const now = Date.now()
        typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : '') + event.key.toLowerCase(), at: now }
        const from = typed.current.text.length === 1 ? at + 1 : at
        const found = [...rows.slice(from), ...rows.slice(0, from)].find((r) => r.node.name.toLowerCase().startsWith(typed.current.text))
        if (found) focusRow(found.node.path)
        break
      }
    }
    event.preventDefault()
  }

  const contextMenu = (event: MouseEvent, node: TreeNode) => {
    event.preventDefault()
    setFocused(node.path)
    setMenu({
      x: event.clientX,
      y: event.clientY,
      label: node.name,
      entries: node.folder
        ? [{ id: 'toggle', label: open.has(node.path) ? t('tree.collapse') : t('tree.expand'), run: () => toggle(node.path) }, { id: 'path', label: t('tabs.copyPath'), run: () => onCopy(node.path) }]
        : [
            { id: 'open', label: t('tree.open'), run: () => onOpen(node.path, true) },
            { id: 'openWith', label: t('tree.openWith'), run: () => onOpenWith(node.path) },
            { id: 'save', label: t('menu.saveAs'), run: () => onSave(node.path) },
            { separator: true },
            { id: 'path', label: t('tabs.copyPath'), run: () => onCopy(node.path) },
          ],
    })
  }

  const current = focused ?? rows[0]?.node.path
  return (
    <>
      <div ref={root} role="tree" aria-label={t('sidebar.treeLabel')} onKeyDown={onKeyDown} className="py-0.5 text-[13px]">
        {rows.map(({ node, depth }) => {
          const expanded = node.folder && open.has(node.path)
          const selected = !node.folder && node.path === activePath
          return (
            <div
              key={node.path}
              role="treeitem"
              data-path={node.path}
              aria-level={depth + 1}
              aria-expanded={node.folder ? expanded : undefined}
              aria-selected={selected}
              tabIndex={node.path === current ? 0 : -1}
              onFocus={() => setFocused(node.path)}
              onClick={() => (node.folder ? toggle(node.path) : onOpen(node.path, false))}
              onDoubleClick={() => !node.folder && onOpen(node.path, true)}
              onContextMenu={(e) => contextMenu(e, node)}
              title={node.path}
              style={{ paddingLeft: 8 + depth * 8 }}
              className={`flex h-[22px] cursor-pointer items-center gap-1 pr-2 outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${selected ? 'bg-list-inactive focus-within:bg-list-active focus-within:text-list-active-fg' : 'hover:bg-list-hover'}`}
            >
              <span className="flex w-4 shrink-0 justify-center">{node.folder ? <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="text-[16px]" /> : null}</span>
              <Icon name={node.folder ? (expanded ? 'folder-opened' : 'folder') : fileIcon(types.get(node.path), node.name)} className="shrink-0 text-[16px]" />
              <span className="truncate">{node.name}</span>
            </div>
          )
        })}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
}
