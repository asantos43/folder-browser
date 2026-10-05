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

/** The arguments of the user: a packaged app is `app files…`, an unpackaged one (`electron . files…`) has the app's own folder first. */
export const userArgs = (argv: readonly string[], packaged: boolean): string[] => argv.slice(packaged ? 1 : 2)
