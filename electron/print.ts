import fs from 'node:fs'
import crypto from 'node:crypto'
import { BrowserWindow, session, type WebContents } from 'electron'
import type { PrintResult } from '../core/api.ts'

/**
 * Prints a web contents with the system's own print dialog. `WSNP_PRINT_TO` (an environment variable, for the tests only) writes
 * a PDF of what would be printed to that path instead, since a test cannot answer a system dialog.
 */
export async function printContents(wc: WebContents): Promise<PrintResult> {
  const to = process.env.WSNP_PRINT_TO
  if (to) {
    try {
      fs.writeFileSync(to, await wc.printToPDF({ printBackground: true }))
      return { printed: true }
    } catch (err) {
      return { printed: false, reason: 'error', message: (err as Error).message }
    }
  }
  return new Promise((resolve) => {
    wc.print({ silent: false, printBackground: true }, (success, failure) => {
      if (success) resolve({ printed: true })
      else resolve({ printed: false, reason: /cancel/i.test(failure) ? 'cancelled' : 'error', message: failure })
    })
  })
}

/** A static page in a window that is never shown, with no script and no network, handed to `use` and then closed. */
export async function usingHtml<T>(html: string, use: (wc: WebContents) => Promise<T>): Promise<T> {
  const partition = `print-${crypto.randomBytes(6).toString('hex')}`
  const ses = session.fromPartition(partition)
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !details.url.startsWith('data:') }))
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  const win = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`)
    return await use(win.webContents)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function printHtml(html: string): Promise<PrintResult> {
  try {
    return await usingHtml(html, printContents)
  } catch (err) {
    return { printed: false, reason: 'error', message: (err as Error).message }
  }
}

/** The PDF of what a web contents shows: A4, with the page's backgrounds, as on screen except where the page has print styles. */
export const pdfOf = (wc: WebContents): Promise<Buffer> => wc.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true })
