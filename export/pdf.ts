import type { WebContents } from 'electron'

export interface PdfOptions {
  /** Paper size in inches (default A4). */
  paperWidth?: number
  paperHeight?: number
  landscape?: boolean
  /** Margins in inches (default 0.4). */
  margin?: number
  scale?: number
  /** `screen` keeps the page's on-screen styles; `print` (default) uses its print styles. */
  media?: 'print' | 'screen'
  /** Text for the running header and footer; without it there are none. */
  header?: string
  footer?: string
  preferCSSPageSize?: boolean
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Chromium fills the elements with these classes: date, title, url, pageNumber, totalPages.
const template = (text: string, pages: boolean) =>
  `<div style="font-size:8px;width:100%;padding:0 24px;display:flex;justify-content:space-between;color:#444;font-family:sans-serif">` +
  `<span>${escapeHtml(text)}</span>${pages ? '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' : ''}</div>`

/**
 * A PDF of the page. Electron does not offer the DevTools `Page.printToPDF`, so this uses
 * `webContents.printToPDF`; the screen media is emulated through the debugger around it.
 */
export async function printToPdf(wc: WebContents, options: PdfOptions = {}): Promise<Buffer> {
  const attached = wc.debugger.isAttached()
  if (!attached) wc.debugger.attach('1.3')
  try {
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: options.media ?? 'print' })
    const margin = options.margin ?? 0.4
    const headerFooter = options.header !== undefined || options.footer !== undefined
    return await wc.printToPDF({
      pageSize: { width: options.paperWidth ?? 8.27, height: options.paperHeight ?? 11.69 },
      landscape: options.landscape ?? false,
      margins: { top: margin + (headerFooter ? 0.3 : 0), bottom: margin + (headerFooter ? 0.3 : 0), left: margin, right: margin },
      scale: options.scale ?? 1,
      printBackground: true,
      preferCSSPageSize: options.preferCSSPageSize ?? false,
      displayHeaderFooter: headerFooter,
      headerTemplate: template(options.header ?? '', false),
      footerTemplate: template(options.footer ?? '', true),
    })
  } finally {
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: '' }).catch(() => {})
    if (!attached) wc.debugger.detach()
  }
}
