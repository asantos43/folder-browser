import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { chooseFrom, type Choices, type Runner } from '../core/apps.ts'

const run = promisify(execFile)

export type OpenWithOutcome = { opened: true; chooser: boolean } | { opened: false; reason: 'cancelled' | 'error'; message?: string }

/** Runs a program in the C locale, so that what it prints can be read whatever the language of the desktop. */
const runner: Runner = async (command, args) => (await run(command, args, { env: { ...process.env, LC_ALL: 'C' }, timeout: 15_000 })).stdout

/**
 * Linux: what the viewer's own chooser shows for `file` (its type, the applications of the desktop), or null when `gio` is not there and the
 * default application has to do. The system's own chooser cannot be used: a program cannot make it a child of its window on Wayland, and the desktop
 * puts it behind the window that asked.
 */
export async function linuxChoices(file: string): Promise<Choices | null> {
  try {
    return await chooseFrom(file, runner)
  } catch {
    return null
  }
}

/** Opens `file` with the application of a desktop file (`gio launch`, which runs it as the desktop would). */
export async function launchWith(desktopFile: string, file: string): Promise<OpenWithOutcome> {
  try {
    await run('gio', ['launch', desktopFile, file], { timeout: 15_000 })
    return { opened: true, chooser: true }
  } catch (err) {
    return { opened: false, reason: 'error', message: (err as Error).message }
  }
}

/** Makes an application the default for a type, as the dialog's "Always use for this file type" does. A failure is not the user's concern: the file is open. */
export async function makeDefault(mime: string, appId: string): Promise<void> {
  await run('gio', ['mime', mime, appId], { timeout: 15_000 }).catch(() => undefined)
}

/** The default application, for a system with no way to choose. */
export async function openWithDefault(file: string): Promise<OpenWithOutcome> {
  const failure = await shell.openPath(file)
  return failure ? { opened: false, reason: 'error', message: failure } : { opened: true, chooser: false }
}

/**
 * Windows' "Open with" dialog, and macOS's choose-an-application dialog and then `open -a`: both are in front of the window that asked.
 * (Linux is `linuxChoices`.) `WSNP_OPEN_WITH_LOG`, for the end-to-end tests only, writes the path instead of asking: a test cannot answer a system dialog.
 */
export async function openWithSystem(file: string): Promise<OpenWithOutcome> {
  if (process.env.WSNP_OPEN_WITH_LOG) {
    fs.appendFileSync(process.env.WSNP_OPEN_WITH_LOG, `${file}\n`)
    return { opened: true, chooser: true }
  }
  try {
    if (process.platform === 'win32') {
      spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', file], { detached: true, stdio: 'ignore' }).unref()
      return { opened: true, chooser: true }
    }
    let app: string
    try {
      app = (await run('osascript', ['-e', 'POSIX path of (choose application as alias)'])).stdout.trim()
    } catch {
      return { opened: false, reason: 'cancelled' }
    }
    await run('open', ['-a', app, file])
    return { opened: true, chooser: true }
  } catch (err) {
    return { opened: false, reason: 'error', message: (err as Error).message }
  }
}
