import fs from 'node:fs/promises'
import { openArchive, ArchiveError, type Archive } from '../archive/reader.ts'
import { WSNP_TYPE, WSNPX_TYPE, type Manifest } from '../manifest.ts'
import type { Issue, IssueCode } from './issues.ts'
import { SIGNATURE_ENTRY } from './signature.ts'
import { checkManifest, isFileRecord, isSafePath } from './structure.ts'

export type { Issue, IssueCode } from './issues.ts'
export { UNSUPPORTED } from './issues.ts'
export { verifyContents, type IntegrityReport, type VerifyOptions } from './integrity.ts'
export { verifySignature, type SignatureInfo } from './signature.ts'

export type OpenResult =
  /** The structure passes (checklist steps 1 to 8, without reading the files' bytes). The caller closes `archive`. */
  | { ok: true; archive: Archive; manifest: Manifest }
  /** Refused. `issues[0]` is the main reason; `omitted` counts the ones left out of a long list. */
  | { ok: false; issues: Issue[]; omitted: number }

const MAX_ISSUES = 50
const ARCHIVE_CODES: Record<ArchiveError['code'], IssueCode> = {
  'not-zip': 'not-zip',
  zip64: 'zip64',
  encrypted: 'zip-encrypted',
  method: 'zip-method',
  'unsafe-path': 'unsafe-path',
  'missing-entry': 'not-zip',
  range: 'not-zip',
}

const refuse = (issues: Issue[]): OpenResult => ({ ok: false, issues: issues.slice(0, MAX_ISSUES), omitted: Math.max(0, issues.length - MAX_ISSUES) })

/**
 * Opens a .wsnp and checks its structure, following the checklist of wsnp-format/FORMAT.md section 10 (steps 1 to 8) except
 * the files' bytes: sizes come from the ZIP directory, the SHA-256 of each file is checked later by `verifyContents`,
 * so a file of gigabytes opens at once. A protected file or a `.wsnpx` is not opened, and the issue says which.
 */
export async function openWsnp(path: string): Promise<OpenResult> {
  let archive: Archive
  try {
    archive = await openArchive(path)
  } catch (err) {
    if (err instanceof ArchiveError) return refuse([{ code: ARCHIVE_CODES[err.code], detail: err.message }])
    throw err
  }
  try {
    const result = await check(archive)
    if (result.ok) return result
    await archive.close()
    return result
  } catch (err) {
    await archive.close()
    throw err
  }
}

/** The local header at the start of the file: `PK\3\4`, method 0, a name of 8 bytes, no extra field, then `mimetype`. */
async function plainMimetypeHeader(path: string): Promise<boolean> {
  const file = await fs.open(path, 'r')
  try {
    const head = Buffer.alloc(38)
    const { bytesRead } = await file.read(head, 0, 38, 0)
    return bytesRead === 38 && head.readUInt32LE(0) === 0x04034b50 && head.readUInt16LE(8) === 0 && head.readUInt16LE(26) === 8 && head.readUInt16LE(28) === 0 && head.toString('latin1', 30, 38) === 'mimetype'
  } finally {
    await file.close()
  }
}

async function check(archive: Archive): Promise<OpenResult> {
  // 1. the first entry is `mimetype`, stored, with no extra field (and so its text is where FORMAT.md section 3 says).
  const first = archive.entries[0]
  if (first?.name !== 'mimetype' || first.method !== 0 || !(await plainMimetypeHeader(archive.path))) return refuse([{ code: 'first-entry' }])
  if (first.size > 256) return refuse([{ code: 'not-wsnp' }])
  const type = (await archive.read('mimetype')).toString('latin1')
  // 2. the media type
  if (type === WSNPX_TYPE) return refuse([{ code: 'application' }])
  if (type !== WSNP_TYPE) return refuse([{ code: 'not-wsnp', detail: type.slice(0, 80) }])
  // 3. a protected file (FORMAT.md section 9) is recognised by `encryption.json`
  if (archive.get('encryption.json')) return refuse([{ code: 'protected' }])

  // 4. and 5. the manifest
  if (!archive.get('manifest.json')) return refuse([{ code: 'no-manifest' }])
  if (archive.get('manifest.json')!.size > 64 * 2 ** 20) return refuse([{ code: 'manifest-json', detail: 'too large' }])
  let raw: unknown
  try {
    raw = JSON.parse((await archive.read('manifest.json')).toString('utf8'))
  } catch {
    return refuse([{ code: 'manifest-json' }])
  }
  const { manifest, issues } = checkManifest(raw)
  if (!manifest) return refuse(issues)

  // 6. every entry name follows section 5 and is unique when case is ignored (methods and encryption were checked opening the archive)
  const seen = new Set<string>()
  for (const entry of archive.entries) {
    if (!isSafePath(entry.name)) issues.push({ code: 'unsafe-path', path: entry.name })
    const folded = entry.name.toLowerCase()
    if (seen.has(folded)) issues.push({ code: 'path-clash', path: entry.name })
    seen.add(folded)
  }
  // 7. every entry but `mimetype` and `manifest.json` is listed, every listed file is there with the size the manifest says
  const listed = new Map<string, number>()
  for (const record of manifest.files) {
    if (!isFileRecord(record)) {
      issues.push({ code: 'file-record', path: typeof (record as { path?: unknown })?.path === 'string' ? (record as { path: string }).path : undefined })
      continue
    }
    listed.set(record.path, record.bytes)
    const entry = archive.get(record.path)
    if (!entry) issues.push({ code: 'file-missing', path: record.path })
    else if (entry.size !== record.bytes) issues.push({ code: 'size-mismatch', path: record.path, detail: `${entry.size} in the file, ${record.bytes} in the manifest` })
  }
  for (const entry of archive.entries) {
    if (entry.name !== 'mimetype' && entry.name !== 'manifest.json' && entry.name !== SIGNATURE_ENTRY && !listed.has(entry.name)) issues.push({ code: 'entry-not-listed', path: entry.name })
  }
  // 8. the page and the preview
  const page = manifest.pages[0].entry
  if (!archive.get(page)) issues.push({ code: 'page-missing', path: page })
  if (manifest.preview !== undefined && !archive.get(manifest.preview)) issues.push({ code: 'preview-missing', path: manifest.preview })

  return issues.length ? refuse(issues) : { ok: true, archive, manifest }
}
