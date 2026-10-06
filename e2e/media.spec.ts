import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { wavBuffer } from '../fixtures/audio.ts'
import { sampleFiles, writeWsnp } from '../fixtures/build.ts'
import { zipSync } from '../fixtures/zip.ts'
import { goToFile } from './helpers.ts'

// End-to-end: videos and sounds of a folder or a ZIP, played in a tab (a sound the browser plays with no codec: a WAV).
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let tmp: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-media-'))
  work = path.join(dir, 'music')
  tmp = path.join(dir, 'tmp')
  fs.mkdirSync(work)
  fs.mkdirSync(tmp)
  fs.writeFileSync(path.join(work, '1-first.wav'), wavBuffer(2, 440))
  fs.writeFileSync(path.join(work, '2-second.wav'), wavBuffer(2, 660))
  fs.writeFileSync(path.join(work, '3-third.wav'), wavBuffer(1, 880))
  fs.writeFileSync(path.join(work, 'notes.txt'), 'play me')
  fs.mkdirSync(path.join(work, 'bad'))
  fs.writeFileSync(path.join(work, 'bad', 'broken.mp4'), Buffer.from('this is not a video at all, only text pretending'))
  fs.writeFileSync(path.join(work, 'pack.zip'), zipSync([{ name: 'inside.wav', data: wavBuffer(1, 330) }]))
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args], env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
const audio = (page: Page) => page.locator('audio:visible')
const state = (page: Page) => page.locator('audio').first().evaluate((a: HTMLAudioElement) => ({ paused: a.paused, time: a.currentTime, duration: a.duration, src: a.currentSrc, error: a.error?.code ?? 0 }))
const copies = () => fs.readdirSync(tmp).filter((n) => n.startsWith('fb-media-'))

test('a sound of a folder opens in a player, and plays: its length is known, it can be sought and its time moves', async () => {
  const page = await launch(work)
  await item(page, '1-first.wav').dblclick()
  await expect(audio(page)).toBeVisible()
  await expect.poll(async () => (await state(page)).duration).toBeCloseTo(2, 0)
  const first = await state(page)
  expect(first.src).toMatch(/^fb-media:\/\/m[0-9a-f]{24}\/$/)
  expect(first.error).toBe(0)
  // Seeking asks the main process for a range of the file.
  await audio(page).evaluate((a: HTMLAudioElement) => void (a.currentTime = 1))
  await expect.poll(async () => (await state(page)).time).toBeGreaterThanOrEqual(1)
  await audio(page).evaluate((a: HTMLAudioElement) => {
    a.muted = true
    void a.play()
  })
  await expect.poll(async () => (await state(page)).paused).toBe(false)
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(1.1)
  // The file is the folder's own, not a copy.
  expect(copies()).toEqual([])
})

test('Next and Previous go through the sounds of the folder, and only those', async () => {
  const page = await launch(work)
  await item(page, '2-second.wav').dblclick()
  await expect(page.getByRole('tab', { selected: true })).toContainText('2-second.wav')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('3-third.wav')
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByRole('button', { name: 'Previous' }).click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('2-second.wav')
  await page.getByRole('button', { name: 'Previous' }).click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('1-first.wav')
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
})

test('a sound goes on playing when another tab comes to the front, and stops when its tab is closed', async () => {
  const page = await launch(work)
  await item(page, '1-first.wav').dblclick()
  await expect(audio(page)).toBeVisible()
  await audio(page).evaluate((a: HTMLAudioElement) => {
    a.muted = true
    void a.play()
  })
  await expect.poll(async () => (await state(page)).paused).toBe(false)
  await item(page, 'notes.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('play me')
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(audio(page)).toHaveCount(0)
  const before = (await state(page)).time
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(before)
  expect((await state(page)).paused).toBe(false)
  await page.getByRole('tab', { name: /1-first/ }).click({ button: 'middle' })
  await expect(page.locator('audio')).toHaveCount(0)
})

test('a sound inside a ZIP plays from a copy that is removed when the tab closes', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await item(page, 'inside.wav').dblclick()
  await expect(audio(page)).toBeVisible()
  await expect.poll(async () => (await state(page)).duration).toBeCloseTo(1, 0)
  expect(copies()).toHaveLength(1)
  expect(fs.readdirSync(path.join(tmp, copies()[0]))).toEqual(['inside.wav'])
  await page.keyboard.press('ControlOrMeta+w')
  await expect.poll(copies).toEqual([])
})

test('what the player cannot decode is said in words, with Open With… and Save As as the way out', async () => {
  const page = await launch(work)
  await item(page, 'bad').click()
  await item(page, 'broken.mp4').dblclick()
  await expect(page.getByRole('alert')).toContainText('does not know its format')
  await expect(page.getByRole('button', { name: 'Open With…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save As…' })).toBeVisible()
})

test('the menu of a media file says Play, and a sound is shown with the icon of a sound', async () => {
  const page = await launch(work)
  await item(page, '1-first.wav').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Play' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Play' }).click()
  await expect(audio(page)).toBeVisible()
  await item(page, 'notes.txt').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Play' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible()
})

test('a sound of a snapshot is played too, by the type its manifest declares, and one it cannot decode is said', async () => {
  const file = path.join(dir, 'tunes.wsnp')
  await writeWsnp(file, [
    ...sampleFiles(),
    { path: 'assets/media/tune.wav', type: 'audio/wav', data: wavBuffer(1, 523) },
    { path: 'assets/media/clip.mp4', type: 'video/mp4', data: Buffer.alloc(512, 1) },
  ])
  const page = await launch(file)
  await goToFile(page, 'tune.wav')
  await expect(audio(page)).toBeVisible()
  await expect.poll(async () => (await state(page)).duration).toBeCloseTo(1, 0)
  expect((await state(page)).src).toMatch(/^fb-media:\/\/m[0-9a-f]{24}\/$/)
  // The copy of a file of a snapshot is made for the tab, and goes with it.
  expect(copies()).toHaveLength(1)
  await page.keyboard.press('ControlOrMeta+w')
  await expect.poll(copies).toEqual([])
  await goToFile(page, 'clip.mp4')
  await expect(page.getByRole('alert')).toContainText('does not know its format')
})
