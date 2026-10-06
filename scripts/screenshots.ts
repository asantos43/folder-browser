// Pictures of the real application for the README and the user guide, made from synthetic files (`scripts/demo-folder.ts`), never from a real capture:
//   npm run build && node scripts/screenshots.ts            → docs/images/*.png
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type Locator, type Page } from '@playwright/test'
import { makeDemoFolder } from './demo-folder.ts'

const out = path.resolve(import.meta.dirname, '../docs/images')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-shots-'))
const demo = await makeDemoFolder(path.join(work, 'Harbor Times'))
fs.mkdirSync(out, { recursive: true })

const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(work, 'profile')}`, '--lang=en-US', demo], env: { ...process.env, XDG_DATA_HOME: path.join(work, 'data') } })
const page: Page = await app.firstWindow()
await page.getByTestId('titlebar').waitFor()
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))

const tree = page.getByRole('tree', { name: 'Files and folders' })
const item = (name: string): Locator => tree.getByRole('treeitem', { name, exact: true })
const shot = async (name: string) => {
  // (Notices from the step before are let go, so that a picture shows what it is about.)
  for (const dismiss of await page.getByRole('button', { name: 'Dismiss' }).all()) await dismiss.click().catch(() => undefined)
  await page.waitForTimeout(450)
  await page.screenshot({ path: path.join(out, `${name}.png`) })
  console.log('shot', name)
}
const step = async (name: string, run: () => Promise<void>) => {
  try {
    await run()
  } catch (err) {
    console.error(`FAILED ${name}:`, (err as Error).message.split('\n')[0])
  }
  await page.keyboard.press('Escape').catch(() => undefined)
}
const closeAll = async () => {
  for (let i = 0; i < 12; i++) {
    const tab = page.getByRole('tab').first()
    if (!(await tab.count())) break
    await tab.click({ button: 'middle' }).catch(() => undefined)
    await page.waitForTimeout(80)
    const ask = page.getByRole('alertdialog')
    if (await ask.count()) await ask.getByRole('button', { name: /Don.t Save/ }).click().catch(() => undefined)
  }
}
const theme = async (name: 'Dark+' | 'Light+') => {
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitemcheckbox', { name }).click()
  await page.waitForTimeout(300)
}
const typeAtEnd = async (text: string) => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(text)
}

await step('theme', () => theme('Light+'))

await step('workbench', async () => {
  await item('src').click()
  await item('main.ts').dblclick()
  await page.locator('.cm-content').waitFor()
  await item('README.md').click()
  await shot('workbench')
})

await step('context-menu', async () => {
  await item('notes.txt').click({ button: 'right' })
  await shot('context-menu')
  await page.keyboard.press('Escape')
})

await step('editing', async () => {
  await closeAll()
  await item('notes.txt').dblclick()
  await page.locator('.cm-content').waitFor()
  await typeAtEnd('\n  - tea for Bruno')
  await shot('editing')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
})

await step('rename', async () => {
  await item('todo.txt').focus()
  await page.keyboard.press('F2')
  await page.getByRole('textbox', { name: 'Name' }).fill('todo-march.txt')
  await shot('rename')
  await page.keyboard.press('Escape')
})

await step('multiselect', async () => {
  await page.keyboard.press('Escape')
  await item('notes.txt').click()
  await item('todo.txt').click({ modifiers: ['ControlOrMeta'] })
  await item('data.csv').click({ modifiers: ['ControlOrMeta'] })
  await item('data.csv').click({ button: 'right' })
  await shot('multiselect')
  await page.keyboard.press('Escape')
})

await step('move-dialog', async () => {
  await item('notes.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Move 3 Items to/ }).click()
  await shot('move-dialog')
  await page.keyboard.press('Escape')
})

await step('clipboard', async () => {
  await item('notes.txt').click()
  await item('notes-old.txt').click({ modifiers: ['ControlOrMeta'] })
  await item('notes-old.txt').focus()
  await page.keyboard.press('ControlOrMeta+x')
  await item('docs').click({ button: 'right' })
  await shot('clipboard-menu')
  await page.keyboard.press('Escape')
  // (A copy takes the place of the cut, and no row stays dimmed in the next pictures.)
  await item('docs').focus()
  await page.keyboard.press('ControlOrMeta+c')
  await page.keyboard.press('Escape')
  await item('docs').click()
})

await step('table', async () => {
  await closeAll()
  await item('data.csv').dblclick()
  await page.getByRole('table').first().waitFor().catch(() => undefined)
  await shot('table')
})

await step('diff', async () => {
  await closeAll()
  await item('notes.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Select for Compare' }).click()
  await item('notes-old.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compare with Selected' }).click()
  await page.getByRole('group', { name: /^Comparison of / }).waitFor()
  await shot('diff')
})

await step('zip', async () => {
  await closeAll()
  await item('archive.zip').click()
  await item('letters').click()
  await item('ana.txt').dblclick()
  await page.locator('.cm-content').waitFor()
  await typeAtEnd('P.S. Bring the umbrella.')
  await item('bruno.txt').click({ button: 'right' })
  await shot('zip-edit')
  await page.keyboard.press('Escape')
})

await step('split', async () => {
  await closeAll()
  await item('notes.txt').dblclick()
  await item('todo.txt').dblclick()
  await page.getByRole('tab', { name: /^todo\.txt/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Split Right' }).click()
  await shot('split')
})

await step('hex', async () => {
  await closeAll()
  await item('tool.bin').dblclick()
  await shot('hex')
})

await step('pdf', async () => {
  await closeAll()
  await item('manual.pdf').dblclick()
  await page.locator('canvas').first().waitFor()
  await shot('pdf')
})

await step('image', async () => {
  await closeAll()
  await item('photos').click()
  await item('harbor.png').dblclick()
  await shot('image')
})

await step('audio', async () => {
  await closeAll()
  await item('music').click()
  await item('chime.wav').dblclick()
  await shot('media')
})

await step('documents', async () => {
  await closeAll()
  await item('report.docx').dblclick()
  await page.waitForTimeout(1500)
  await shot('docx')
  await closeAll()
  await item('budget.ods').dblclick()
  await page.waitForTimeout(1500)
  await shot('spreadsheet')
})

await step('snapshot', async () => {
  await closeAll()
  await item('harbor-times.wsnp').dblclick()
  await page.getByRole('contentinfo').getByRole('button', { name: /Intact/ }).waitFor()
  await shot('snapshot')
})

await step('quick-open', async () => {
  await page.keyboard.press('ControlOrMeta+e')
  await page.getByRole('combobox', { name: 'Go to File' }).fill('note')
  await shot('quick-open')
})

await step('find', async () => {
  await closeAll()
  await item('main.ts').dblclick()
  await page.locator('.cm-content').waitFor()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByRole('textbox', { name: 'Find' }).fill('greet')
  await shot('find')
  await page.keyboard.press('Escape')
})

await step('settings', async () => {
  await closeAll()
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitem', { name: /^Settings/ }).click()
  await shot('settings')
})

await step('dark', async () => {
  await theme('Dark+')
  await shot('workbench-dark')
})

await app.close()
fs.rmSync(work, { recursive: true, force: true })
