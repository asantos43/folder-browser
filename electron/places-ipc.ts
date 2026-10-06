import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, shell, type BrowserWindow } from 'electron'
import type { OpenResult } from '../core/api.ts'
import type { FavoriteFolders } from '../core/favorites.ts'
import { knownPlaces, placeOf, volumesOf, type KnownPaths, type Place, type PlacesData } from '../core/places.ts'
import type { RecentFiles } from '../core/recent.ts'
import type { RootRegistry } from '../core/roots.ts'
import { Trash, trashFolderOf, type RestoreResult } from '../core/trash.ts'

export type Handle = <A extends unknown[], R>(channel: string, fn: (win: BrowserWindow, ...args: A) => R | Promise<R>) => void

const isDirectory = (folder: string): Promise<boolean> => fs.stat(folder).then((s) => s.isDirectory(), () => false)

/** The places of the side bar, the favourites, and the trash. Only the window's own interface may call (`handle` checks it). */
export function registerPlacesIpc(handle: Handle, deps: { roots: RootRegistry; favorites: FavoriteFolders; recentFolders: RecentFiles; openRoot: (target: string, options?: { trash?: boolean }) => Promise<OpenResult> }): void {
  const home = os.homedir()
  const trashFolder = trashFolderOf(process.platform, home)
  const known = (name: Parameters<typeof app.getPath>[0]): string | undefined => {
    try {
      return app.getPath(name)
    } catch {
      return undefined
    }
  }

  handle('fb:places-list', async (): Promise<PlacesData> => {
    const paths: KnownPaths = { home, desktop: known('desktop'), documents: known('documents'), downloads: known('downloads'), music: known('music'), pictures: known('pictures'), videos: known('videos'), ...(trashFolder ? { trash: trashFolder } : {}), computer: process.platform === 'win32' ? path.parse(home).root : '/' }
    const places = await knownPlaces(paths, isDirectory)
    // The Recycle Bin of Windows is not a folder: its row has no path, and opens the system's own.
    if (process.platform === 'win32') places.splice(places.findIndex((p) => p.kind === 'computer') >>> 0, 0, { id: 'trash:', kind: 'trash', name: 'trash', path: '' })
    const volumes = await volumesOf(process.platform, os.userInfo().username, (folder) => fs.readdir(folder), isDirectory)
    const recent: Place[] = []
    for (const folder of deps.recentFolders.list()) if (await fs.stat(folder).then(() => true, () => false)) recent.push(placeOf('recent', folder))
    return { places, volumes, recent, favorites: deps.favorites.list().map((folder) => placeOf('favorite', folder)) }
  })

  handle('fb:places-open-trash', async (): Promise<OpenResult[]> => {
    if (!trashFolder) {
      await shell.openPath('shell:RecycleBinFolder')
      return []
    }
    return [await deps.openRoot(trashFolder, { trash: true })]
  })

  handle('fb:favorites-add', async (_win, id: unknown, name: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || typeof name !== 'string') return false
    const folder = await deps.roots.diskDir(id, name)
    return folder ? deps.favorites.add(folder) : false
  })
  handle('fb:favorites-remove', (_win, folder: unknown) => {
    if (typeof folder === 'string') deps.favorites.remove(folder)
  })
  handle('fb:favorites-move', (_win, folder: unknown, to: unknown) => {
    if (typeof folder === 'string' && typeof to === 'number' && Number.isInteger(to)) deps.favorites.move(folder, to)
  })
  handle('fb:recent-folders-clear', () => deps.recentFolders.clear())

  const trashOf = (id: unknown): Trash | null => {
    const root = typeof id === 'string' ? deps.roots.info(id) : undefined
    return root?.trash ? new Trash(root.path) : null
  }
  handle('fb:trash-restore', async (_win, id: unknown, name: unknown): Promise<RestoreResult> => {
    const trash = trashOf(id)
    return trash && typeof name === 'string' ? trash.restore(name) : { error: 'no-item' }
  })
  handle('fb:trash-empty', async (_win, id: unknown): Promise<number> => (await trashOf(id)?.empty()) ?? 0)
}
