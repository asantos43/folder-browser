import fs from 'node:fs'
import path from 'node:path'

/**
 * What a command line asks to open (a double-click on a `.wsnp` passes its path as an argument, a file manager's "open with" passes a folder or a file), made absolute:
 * the `.wsnp` and `.zip` files, whether or not they are there (a missing one is refused in words), and any other path that exists (a folder, or a file of one).
 * Flags are skipped. The caller gives the arguments after the program's own (`electron .` has the app's folder first).
 */
export function pathsToOpen(argv: readonly string[], cwd: string, exists: (file: string) => boolean = fs.existsSync): string[] {
  return argv
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => path.resolve(cwd, arg))
    .filter((file) => /\.(wsnp|zip)$/i.test(file) || exists(file))
}

/**
 * The arguments of the user: those after the program's own. An unpackaged app (`electron . files…`, or a test driver that puts its own flags before) is also given
 * its own folder, which is not something to open: the first argument that is that folder is dropped.
 */
export function userArgs(argv: readonly string[], packaged: boolean, appPath: string, cwd: string): string[] {
  const rest = argv.slice(1)
  if (packaged) return rest
  const own = rest.findIndex((arg) => !arg.startsWith('-') && path.resolve(cwd, arg) === path.resolve(appPath))
  return own < 0 ? rest : rest.filter((_, i) => i !== own)
}
