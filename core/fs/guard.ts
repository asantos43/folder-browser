import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * The path, under `root`, that a relative path of the interface means; null when it would leave the root. The interface never sends an absolute path:
 * it names a root it opened and a path relative to it (`docs/a.txt`, with `/` between the parts), and the main process resolves it here.
 * `..`, an absolute path, a drive, a backslash or a NUL are refused, and so is a symbolic link whose target is outside the root (the real path is compared).
 * The root itself is `''`.
 */
export async function resolveInside(root: string, relative: string): Promise<string | null> {
  if (relative === '') return root
  if (relative.includes('\0') || relative.includes('\\') || relative.startsWith('/') || /^[a-zA-Z]:/.test(relative)) return null
  const parts = relative.split('/').filter((p) => p !== '')
  if (!parts.length || parts.some((p) => p === '.' || p === '..')) return null
  const target = path.join(root, ...parts)
  try {
    const [real, base] = await Promise.all([fs.realpath(target), fs.realpath(root)])
    return real === base || real.startsWith(base + path.sep) ? real : null
  } catch {
    return null
  }
}
