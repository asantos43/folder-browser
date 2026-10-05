import { KNOWN_MAJOR, type Manifest, type ManifestFile } from '../manifest.ts'
import type { Issue } from './issues.ts'

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** FORMAT.md section 5: ASCII letters, digits and `. _ - /`; relative; no empty, `.` or `..` segment; at most 255 characters. */
export function isSafePath(name: string): boolean {
  return name.length > 0 && name.length <= 255 && /^[A-Za-z0-9._/-]+$/.test(name) && name.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/** An address the page came from: http, https, or file for a local capture. */
function isAddress(value: unknown): boolean {
  if (!isString(value)) return false
  try {
    return /^(https?|file):$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

/** Steps 4 and 5 of the checklist: the manifest is an object of the right format and version, with its required fields. */
export function checkManifest(raw: unknown): { manifest?: Manifest; issues: Issue[] } {
  if (!isObject(raw)) return { issues: [{ code: 'manifest-json', detail: 'not an object' }] }
  if (raw.format !== 'wsnp') return { issues: [{ code: 'format', field: 'format', detail: String(raw.format) }] }
  const version = /^(\d+)\.(\d+)$/.exec(isString(raw.format_version) ? raw.format_version : '')
  if (!version) return { issues: [{ code: 'bad-version', field: 'format_version' }] }
  if (Number(version[1]) > KNOWN_MAJOR) return { issues: [{ code: 'newer-version', field: 'format_version', detail: String(raw.format_version) }] }
  if (Number(version[1]) < KNOWN_MAJOR) return { issues: [{ code: 'bad-version', field: 'format_version' }] }

  const issues: Issue[] = []
  const need = (field: string, ok: boolean) => ok || issues.push({ code: 'field', field })
  const generator = raw.generator
  need('generator', isObject(generator) && isString(generator.name) && isString(generator.version))
  need('created', isString(raw.created) && !Number.isNaN(Date.parse(raw.created)))
  need('title', isString(raw.title))
  need('description', isString(raw.description))
  const viewport = raw.viewport
  need('viewport', isObject(viewport) && isNumber(viewport.width) && isNumber(viewport.height))
  need('pages', Array.isArray(raw.pages) && raw.pages.length === 1 && isObject(raw.pages[0]) && isString(raw.pages[0].entry))
  need('files', Array.isArray(raw.files))
  need('failed', Array.isArray(raw.failed))
  need('preview', raw.preview === undefined || isString(raw.preview))
  const source = raw.source
  if (!isObject(source) || !isAddress(source.url)) issues.push({ code: 'source-url', field: 'source.url' })
  return issues.length ? { issues } : { manifest: raw as unknown as Manifest, issues }
}

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i

/** Whether one record of `files` is well formed (FORMAT.md section 6). */
export function isFileRecord(f: unknown): f is ManifestFile {
  return isObject(f) && isString(f.path) && isString(f.media_type) && MEDIA_TYPE.test(f.media_type) && isNumber(f.bytes) && Number.isInteger(f.bytes) && f.bytes >= 0 && isString(f.sha256) && /^[0-9a-f]{64}$/.test(f.sha256)
}
