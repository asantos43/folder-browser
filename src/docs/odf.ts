import { Odr } from '@opendocument/odr-core'
import { boot, docName } from './boot.ts'

// The OpenDocument family, the older Office files and every spreadsheet: odr-core (WebAssembly) renders a view of the document to a page of its own, drawn here in a
// frame. A workbook has a bar to go from one sheet to another.
boot(async (bytes, root) => {
  const odr = await Odr.load()
  const doc = odr.open(new Uint8Array(bytes), { name: docName() })
  if (doc.isPasswordEncrypted()) throw new Error('This document is protected by a password.')
  // The first view is the whole document: for a workbook that is every sheet one under the other, with no names, so a workbook is shown one sheet at a time (a bar names them).
  const all = doc.listViews()
  const views = all.length > 1 && all[1].path.startsWith('sheet') ? all.slice(1) : all.slice(0, 1)
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.style.cssText = 'flex:1;min-height:0;width:100%;border:0;background:#fff'
  const show = (index: number) => {
    frame.srcdoc = doc.render(index).html
  }
  root.style.cssText = 'display:flex;flex-direction:column;height:100vh'
  root.append(frame)
  if (views.length > 1) {
    const bar = document.createElement('div')
    bar.style.cssText = 'display:flex;gap:2px;overflow-x:auto;background:#e8e8e8;border-top:1px solid #bbb;padding:2px 4px;flex:none;font:12px system-ui,sans-serif'
    const buttons = views.map((view) => {
      const button = document.createElement('button')
      button.textContent = view.name || String(view.index + 1)
      button.style.cssText = 'border:1px solid transparent;background:transparent;padding:3px 10px;cursor:pointer;color:#222;white-space:nowrap'
      button.addEventListener('click', () => {
        for (const other of buttons) other.style.background = 'transparent'
        button.style.background = '#fff'
        show(view.index)
      })
      return button
    })
    bar.append(...buttons)
    root.append(bar)
    buttons[0].style.background = '#fff'
  }
  show(views[0]?.index ?? 0)
  return { views: Math.max(1, views.length) }
})
