import { renderAsync } from 'docx-preview'
import { boot } from './boot.ts'

// A Word document, drawn page by page with its headers, footers, notes, tables and pictures. Everything it needs is in the file (pictures as data: addresses).
boot(async (bytes, root) => {
  await renderAsync(bytes, root, undefined, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, useBase64URL: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true })
})
