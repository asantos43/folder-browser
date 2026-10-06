import type { DirEntry, RootInfo } from '@core/api.ts'

/** What a row of the tree can offer. The menu of each kind of row is a list of these (and separators); the tree gives each its label and what it does. */
export type TreeAction = 'toggle' | 'refresh' | 'open' | 'openAsList' | 'openSnapshot' | 'openAsZip' | 'openWith' | 'openDefault' | 'save' | 'reveal' | 'copyPath' | 'copyName' | 'properties'
export type TreeMenuItem = TreeAction | 'separator'

/**
 * The right-click menu of a row, by what the row is. A folder expands and refreshes; a ZIP file expands and can be opened as a list; a `.wsnp` opens as a snapshot or as a ZIP;
 * every other file opens in a tab. Every file, whatever it is, can be opened in another application (**Open With…**, and the default one), saved, shown in its folder
 * and have its path copied; those are the last group of the menu. (Editing, comparing and playing join the lists as those phases land.)
 */
export function treeMenuFor(entry: Pick<DirEntry, 'kind'>): TreeMenuItem[] {
  const where: TreeMenuItem[] = ['reveal', 'copyPath', 'copyName', 'separator', 'properties']
  const application: TreeMenuItem[] = ['openWith', 'openDefault', 'save', 'separator']
  switch (entry.kind) {
    case 'dir':
      return ['toggle', 'refresh', 'separator', ...where]
    case 'zip':
      return ['toggle', 'openAsList', 'separator', ...application, ...where]
    case 'wsnp':
      return ['openSnapshot', 'openAsZip', 'separator', ...application, ...where]
    default:
      return ['open', 'separator', ...application, ...where]
  }
}

/** Where an entry is, for a person: the folder or ZIP file that was opened, then the path in it (`!/` into a ZIP, as the app writes it). */
export function locationOf(root: Pick<RootInfo, 'kind' | 'path'>, path: string, separator: string): string {
  const parts = path.split('!/')
  const first = parts[0].split('/').join(separator)
  const rest = parts.slice(1).map((part) => `!/${part}`).join('')
  const base = root.path.replace(/[\\/]+$/, '')
  return root.kind === 'zip' ? `${base}!/${path}` : `${base}${separator}${first}${rest}`
}
