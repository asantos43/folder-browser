import path from 'node:path'
import type { FileSource } from './sources.ts'
import { expandSelection, extractEntries, extractToFile, ZipError } from './zip.ts'

export type ExtractResult =
  | { extracted: number; /** The folder the files went to (several files) … */ folder?: string; /** … or the file (one). */ path?: string; skipped: number; firstSkipped?: { name: string; reason: string } }
  | { cancelled: true }
  | { error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip' | 'unreadable' }

/** Where the user wants the files: the dialogs are the caller's (Electron's, or a test's). */
export interface ExtractAsk {
  /** One file: where to save it. */
  file(defaultName: string): Promise<string | undefined>
  /** Several files or a folder: the folder to put them in. */
  folder(): Promise<string | undefined>
}

/**
 * Extracts the named entries of a ZIP in a snapshot. One file asks for a file name (as Save As does); anything else asks for a folder
 * and recreates the folders of the ZIP inside it. Nothing leaves the chosen place, and nothing there is overwritten.
 */
export async function extractSelection(registry: FileSource, id: string, zipPath: string, names: readonly string[], ask: ExtractAsk, options: { folder?: boolean } = {}): Promise<ExtractResult> {
  const zip = await registry.zipAt(id, zipPath)
  if ('error' in zip) return { error: zip.error }
  const picked = expandSelection(zip.entries, names)
  const files = picked.filter((e) => !e.directory)
  if (!picked.length) return { error: 'no-file' }
  try {
    if (!options.folder && names.length === 1 && files.length === 1 && !names[0].endsWith('/')) {
      const entry = files[0]
      if (entry.unreadable) return { error: 'unreadable' }
      const target = await ask.file(path.basename(entry.name))
      if (!target) return { cancelled: true }
      await extractToFile(zip, entry.name, target)
      return { extracted: 1, path: target, skipped: 0 }
    }
    const folder = await ask.folder()
    if (!folder) return { cancelled: true }
    const report = await extractEntries(zip, picked, folder)
    return { extracted: report.extracted, folder, skipped: report.skipped.length, ...(report.skipped[0] ? { firstSkipped: report.skipped[0] } : {}) }
  } catch (err) {
    if (err instanceof ZipError) return { error: err.code === 'too-large' ? 'too-large' : 'unreadable' }
    throw err
  }
}
