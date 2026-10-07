import type { DirEntry, RootInfo } from '@core/api.ts'

/** What a row of the tree can offer. The menu of each kind of row is a list of these (and separators); the tree gives each its label and what it does. */
export type TreeAction = 'openAsRoot' | 'cut' | 'copyItems' | 'paste' | 'newFile' | 'newFolder' | 'rename' | 'moveTo' | 'delete' | 'play' | 'restore' | 'addFavorite' | 'toggle' | 'refresh' | 'open' | 'openAsList' | 'openSnapshot' | 'openAsZip' | 'openAsHex' | 'selectForCompare' | 'compareWithSelected' | 'openWith' | 'openDefault' | 'save' | 'reveal' | 'copyPath' | 'copyName' | 'properties'
export type TreeMenuItem = TreeAction | 'separator'

/**
 * The right-click menu of a row, by what the row is. A folder expands and refreshes; a ZIP file expands and can be opened as a list; a `.wsnp` opens as a snapshot or as a ZIP;
 * every other file opens in a tab. Every file, whatever it is, can be opened in another application (**Open With…**, and the default one), saved, shown in its folder
 * and have its path copied; those are the last group of the menu. A text file can be chosen as one side of a comparison (**Select for Compare**) and, once one is chosen, be compared with it.
 */
export function treeMenuFor(entry: Pick<DirEntry, 'kind'>, context: { /** The folder can be pinned to the favourites: a folder of the disk. */ canPin?: boolean; /** A top-level row of the trash: it can be put back. */ trashItem?: boolean; /** The file is a video or a sound: it is played. */ media?: boolean; /** The folder (or ZIP file) is of the disk, in a folder that was opened: it can be made the root of the Explorer's Files. */ canRoot?: boolean; /** Something was cut or copied in this tree: it can be pasted into the folder (or next to the file). */ canPaste?: boolean; /** The item is on the disk, in a folder that was opened: it can be renamed, moved and deleted, and a folder can have files and folders made in it. */ writable?: boolean; /** The file is a text of a size that can be compared: it can be chosen as one side. */ comparable?: boolean; /** Another file was chosen as one side: this one can be the other. */ compareWithSelected?: boolean } = {}): TreeMenuItem[] {
  const restore: TreeMenuItem[] = context.trashItem ? ['restore', 'separator'] : []
  const change: TreeMenuItem[] = context.writable ? ['cut', 'copyItems', ...(context.canPaste ? (['paste'] as const) : []), 'separator', 'rename', 'moveTo', 'delete', 'separator'] : []
  const compare: TreeMenuItem[] = context.comparable ? ['selectForCompare', ...(context.compareWithSelected ? (['compareWithSelected'] as const) : []), 'separator'] : []
  const where: TreeMenuItem[] = ['reveal', 'copyPath', 'copyName', 'separator', 'properties']
  const application: TreeMenuItem[] = ['openAsHex', 'openWith', 'openDefault', 'save', 'separator']
  switch (entry.kind) {
    case 'dir':
      return [...restore, 'toggle', 'refresh', ...(context.canRoot ? (['openAsRoot'] as const) : []), ...(context.writable ? (['newFile', 'newFolder'] as const) : []), ...(context.canPin ? (['addFavorite'] as const) : []), 'separator', ...change, ...where]
    case 'zip':
      return [...restore, 'toggle', 'openAsList', ...(context.canRoot ? (['openAsRoot'] as const) : []), ...(context.writable ? (['newFile', 'newFolder'] as const) : []), 'separator', ...change, ...application, ...where]
    case 'wsnp':
      return [...restore, 'openSnapshot', 'openAsZip', 'separator', ...change, ...application, ...where]
    default:
      return [...restore, context.media ? 'play' : 'open', 'separator', ...compare, ...change, ...application, ...where]
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
