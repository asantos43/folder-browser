import path from 'node:path'

/** The kinds of place the side bar lists. */
export type PlaceKind = 'home' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'trash' | 'computer' | 'volume' | 'recent' | 'favorite'

export interface Place {
  /** Stable for the kind and path: what the list's rows are keyed by. */
  id: string
  kind: PlaceKind
  /** What is written on the row: a place has a name of its own (translated by the interface), a volume or a folder the name of its folder. */
  name: string
  /** On the disk. For the trash of Windows, which is not a folder, there is none and the row opens the system's Recycle Bin. */
  path: string
}

export interface PlacesData {
  /** Home, Desktop, Documents, Downloads, Music, Pictures, Videos, Trash, Computer: only those that exist on this computer. */
  places: Place[]
  /** Mounted volumes (USB sticks, other disks), when there are any. */
  volumes: Place[]
  /** The folders and ZIP files opened lately, the latest first. */
  recent: Place[]
  /** The folders the user pinned, in the order they were pinned. */
  favorites: Place[]
}

/** Where the system keeps the well-known folders (`app.getPath` gives them; a missing one is undefined). */
export interface KnownPaths {
  home?: string
  desktop?: string
  documents?: string
  downloads?: string
  music?: string
  pictures?: string
  videos?: string
  /** The folder of the trashed files, where it is a folder (Linux, macOS). */
  trash?: string
  /** `/`, or the drive of the home folder on Windows. */
  computer?: string
}

const ORDER: Exclude<keyof KnownPaths, never>[] = ['home', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos', 'trash', 'computer']

export const placeOf = (kind: PlaceKind, folder: string, name = path.basename(folder) || folder): Place => ({ id: `${kind}:${folder}`, kind, name, path: folder })

/**
 * The fixed places, in the order of a file manager's side bar. A folder the system does not have (no Music folder on a server) is left out, and two kinds that name the
 * same folder (Desktop and Home on a bare system) keep the first.
 */
export async function knownPlaces(paths: KnownPaths, exists: (folder: string) => Promise<boolean>): Promise<Place[]> {
  const out: Place[] = []
  const seen = new Set<string>()
  for (const kind of ORDER) {
    const folder = paths[kind]
    if (!folder || seen.has(folder) || !(await exists(folder))) continue
    seen.add(folder)
    out.push(placeOf(kind, folder, kind))
  }
  return out
}

/**
 * The volumes mounted by the user: the folders under `/run/media/<user>` and `/media/<user>` (and `/media`, `/mnt`) on Linux, `/Volumes` on macOS (but for the disk the system is on),
 * the drives that answer on Windows. `list` reads a folder's names; `exists` tells whether a path is there.
 */
export async function volumesOf(platform: NodeJS.Platform, user: string, list: (folder: string) => Promise<string[]>, exists: (folder: string) => Promise<boolean>): Promise<Place[]> {
  const out: Place[] = []
  if (platform === 'win32') {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (await exists(`${letter}:\\`)) out.push(placeOf('volume', `${letter}:\\`, `${letter}:`))
    return out
  }
  const parents = platform === 'darwin' ? ['/Volumes'] : [`/run/media/${user}`, `/media/${user}`, '/media', '/mnt']
  for (const parent of parents) {
    for (const name of (await list(parent).catch(() => [])).sort((a, b) => a.localeCompare(b))) {
      // `/media/<user>` is itself under `/media`: it is a parent, not a volume.
      if (parent === '/media' && name === user) continue
      if (name.startsWith('.')) continue
      const folder = path.posix.join(parent, name)
      // On macOS the first entry of /Volumes is a link to the disk the system is on.
      if (platform === 'darwin' && name === 'Macintosh HD') continue
      if (await exists(folder)) out.push(placeOf('volume', folder, name))
    }
  }
  return out
}
