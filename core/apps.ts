import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * The applications of a Linux desktop, read from the `.desktop` files and the MIME database the way GNOME's own "Open With" dialog reads them, so the
 * viewer can show that dialog itself (a program cannot put the system's in front of its window on Wayland). Nothing here launches anything.
 */
export interface DesktopApp {
  /** The desktop file's id (`org.gnome.Loupe.desktop`). */
  id: string
  name: string
  /** The `Icon=` of the file: a theme name or an absolute path. */
  icon: string
  /** Where the file is. */
  file: string
}

export interface AppChoice extends DesktopApp {
  /** Registered for the file's type (the dialog's "Recommended Apps"), as against any other application. */
  recommended: boolean
  /** A picture of the icon as a data URL, when one was found. */
  iconUrl?: string
}

/** Runs a program and gives what it printed (in the C locale, so its words can be read). */
export type Runner = (command: string, args: string[]) => Promise<string>

type Env = Record<string, string | undefined>

/** The folders the desktop reads its data from, most specific first (`XDG_DATA_HOME`, `XDG_DATA_DIRS`, and Flatpak's exports). */
export function dataDirs(env: Env = process.env, home = os.homedir()): string[] {
  const dirs = [env.XDG_DATA_HOME || path.join(home, '.local/share'), ...(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':'), path.join(home, '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share']
  return [...new Set(dirs.filter(Boolean))]
}

/** The language of the desktop, as a `.desktop` file spells it (`pt_BR`), from the usual variables. */
export function desktopLanguage(env: Env = process.env): string {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANGUAGE?.split(':')[0] || env.LANG || ''
  return raw.split('.')[0].split('@')[0]
}

/** `[Desktop Entry]` of a `.desktop` file, with the name in the desktop's language; null for what is not an application to show. */
export function parseDesktopEntry(text: string, id: string, file: string, lang = ''): DesktopApp | null {
  const values = new Map<string, string>()
  let inEntry = false
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('[')) inEntry = line.trim() === '[Desktop Entry]'
    else if (inEntry) {
      const at = line.indexOf('=')
      if (at > 0 && !line.startsWith('#')) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
    }
  }
  if (values.get('Type') !== 'Application' || values.get('NoDisplay') === 'true' || values.get('Hidden') === 'true') return null
  const exec = values.get('Exec') ?? ''
  // One that cannot be given a file has nothing to do here.
  if (!/%[fFuU]/.test(exec)) return null
  const language = lang.split('_')[0]
  const name = values.get(`Name[${lang}]`) || values.get(`Name[${language}]`) || values.get('Name')
  return name ? { id, name, icon: values.get('Icon') ?? '', file } : null
}

/** The output of `gio mime <type>`: the default application, the registered ones, the recommended ones. */
export function parseMimeOutput(text: string): { default?: string; registered: string[]; recommended: string[] } {
  const result = { default: undefined as string | undefined, registered: [] as string[], recommended: [] as string[] }
  let section: 'registered' | 'recommended' | null = null
  for (const line of text.split(/\r?\n/)) {
    if (/^Default application/i.test(line)) result.default = /:\s*(\S+\.desktop)\s*$/.exec(line)?.[1]
    else if (/^Registered applications/i.test(line)) section = 'registered'
    else if (/^Recommended applications/i.test(line)) section = 'recommended'
    else if (/^No (default|registered|recommended)/i.test(line)) continue
    else if (section && /^\s+\S+\.desktop\s*$/.test(line)) result[section].push(line.trim())
  }
  return result
}

/** Every application of the desktop that can be given a file, by the order of the folders (the first file of an id wins), sorted by name. */
export async function scanApplications(dirs: string[], lang = ''): Promise<DesktopApp[]> {
  const found = new Map<string, DesktopApp>()
  const walk = async (folder: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}-`)
      else if (entry.name.endsWith('.desktop')) {
        const id = `${prefix}${entry.name}`
        if (found.has(id)) continue
        const app = parseDesktopEntry(await fs.readFile(full, 'utf8').catch(() => ''), id, full, lang)
        if (app) found.set(id, app)
      }
    }
  }
  for (const dir of dirs) await walk(path.join(dir, 'applications'), '')
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const ICON_SIZES = ['128x128', '96x96', '64x64', '256x256', '48x48', '32x32', 'scalable']
const ICON_LIMIT = 300 * 1024
const MIME_TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', xpm: 'image/x-xpixmap' }

/** The picture of an icon as a data URL: a file named by its path, or a name looked for in the icon themes of the data folders. */
const iconCache = new Map<string, string | undefined>()
export async function findIcon(icon: string, dirs: string[], themes: string[] = []): Promise<string | undefined> {
  if (!icon) return undefined
  const key = `${icon}|${themes.join(',')}|${dirs.join(':')}`
  if (!iconCache.has(key)) iconCache.set(key, await lookUpIcon(icon, dirs, themes))
  return iconCache.get(key)
}

async function lookUpIcon(icon: string, dirs: string[], themes: string[]): Promise<string | undefined> {
  const read = async (file: string): Promise<string | undefined> => {
    const type = MIME_TYPES[path.extname(file).slice(1).toLowerCase()]
    if (!type || type === MIME_TYPES.xpm) return undefined
    try {
      const bytes = await fs.readFile(file)
      return bytes.length <= ICON_LIMIT ? `data:${type};base64,${bytes.toString('base64')}` : undefined
    } catch {
      return undefined
    }
  }
  if (path.isAbsolute(icon)) return read(icon)
  const names = /\.(png|svg)$/i.test(icon) ? [icon] : [`${icon}.png`, `${icon}.svg`]
  for (const theme of [...themes, 'hicolor', 'Adwaita', 'breeze', 'Papirus']) {
    for (const size of ICON_SIZES) {
      for (const dir of dirs) for (const name of names) {
        const found = await read(path.join(dir, 'icons', theme, size, 'apps', name))
        if (found) return found
      }
    }
  }
  for (const dir of dirs) for (const name of names) {
    const found = (await read(path.join(dir, 'pixmaps', name))) ?? (await read(path.join(dir, 'icons', name)))
    if (found) return found
  }
  return undefined
}

/** The name of a MIME type in words (`PNG image`), from the shared MIME database, in the desktop's language where it has it. */
export async function mimeDescription(type: string, dirs: string[], lang = ''): Promise<string> {
  for (const dir of dirs) {
    const xml = await fs.readFile(path.join(dir, 'mime', `${type}.xml`), 'utf8').catch(() => '')
    if (!xml) continue
    const comments = [...xml.matchAll(/<comment(?: xml:lang="([^"]+)")?>([^<]*)<\/comment>/g)]
    const pick = comments.find((c) => c[1] === lang) ?? comments.find((c) => c[1] === lang.split('_')[0]) ?? comments.find((c) => !c[1])
    if (pick) return pick[2].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  }
  return type
}

/** `fn` over `items`, at most `limit` at a time, in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++
        out[at] = await fn(items[at])
      }
    }),
  )
  return out
}

export interface Choices {
  mime: string
  mimeLabel: string
  apps: AppChoice[]
}

/**
 * What the dialog shows for a file: its type, and the applications, those registered for the type first (the default the first of them), then the rest.
 * `run` asks `gio` for the type and the registered applications, so what the desktop says is what is shown.
 */
export async function chooseFrom(file: string, run: Runner, env: Env = process.env, dirs: string[] = dataDirs(env)): Promise<Choices> {
  const lang = desktopLanguage(env)
  const mime = /standard::content-type:\s*(\S+)/.exec(await run('gio', ['info', '-a', 'standard::content-type', file]))?.[1] ?? 'application/octet-stream'
  const registered = parseMimeOutput(await run('gio', ['mime', mime]).catch(() => ''))
  const all = await scanApplications(dirs, lang)
  const byId = new Map(all.map((a) => [a.id, a]))
  const order = [...new Set([...(registered.default ? [registered.default] : []), ...registered.recommended, ...registered.registered])].filter((id) => byId.has(id))
  const recommended = order.map((id) => ({ ...byId.get(id)!, recommended: true }))
  const others = all.filter((a) => !order.includes(a.id)).map((a) => ({ ...a, recommended: false }))
  const theme = await run('gsettings', ['get', 'org.gnome.desktop.interface', 'icon-theme']).then((t) => t.trim().replace(/^'|'$/g, ''), () => '')
  const listed = [...recommended, ...others]
  const icons = await mapLimit(listed, 12, (app) => findIcon(app.icon, dirs, theme ? [theme] : []))
  const apps: AppChoice[] = listed.map((app, i) => ({ ...app, ...(icons[i] ? { iconUrl: icons[i] } : {}) }))
  return { mime, mimeLabel: await mimeDescription(mime, dirs, lang), apps }
}
