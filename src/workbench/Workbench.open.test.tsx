// @vitest-environment happy-dom
import type { IntegrityEvent, OpenResult, FbApi } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import type { SnapshotInfo } from '@core/snapshots.ts'
import { snapshotInfo } from '@/test/fixtures.ts'
import { reloadLanguageSetting } from '@/state/language.ts'
import { viewZoom } from '@/state/viewZoom.ts'
import { reopenSession } from '@/state/setting.ts'
import { forgetReads } from '@/views/FileView.tsx'
import { Workbench } from './Workbench.tsx'

/** What the main process keeps of the last session, for the fake of it below. */
let storedSession: unknown = null

/** The main process, as far as the interface sees it: what it is asked, and what it answers. */
function fakeApi(initial: OpenResult[] = []) {
  const listeners = { opened: new Set<(r: OpenResult[]) => void>(), integrity: new Set<(e: IntegrityEvent) => void>(), command: new Set<(c: string) => void>(), pageContext: new Set<(at: { snapshotId: string; x: number; y: number; hasSelection: boolean }) => void>(), openFile: new Set<(t: { snapshotId: string; path: string }) => void>() }
  const api = {
    platform: 'linux',
    setTitleBar: vi.fn(),
    onCommand: (l: (c: string) => void) => (listeners.command.add(l), () => void listeners.command.delete(l)),
    pathForFile: vi.fn((file: File) => `/dropped/${file.name}`),
    ready: vi.fn(async () => initial),
    openDialog: vi.fn(async (): Promise<OpenResult[]> => []),
    openPaths: vi.fn(async (): Promise<OpenResult[]> => []),
    onOpened: (l: (r: OpenResult[]) => void) => (listeners.opened.add(l), () => void listeners.opened.delete(l)),
    close: vi.fn(async (_id: string) => {}),
    readFile: vi.fn(async (_id: string, path: string) => ({ bytes: new TextEncoder().encode(`contents of ${path}`) })),
    saveFileAs: vi.fn(async (_id: string, path: string) => ({ saved: true as const, path: `/home/me/${path.split('/').at(-1)}` })),
    verify: vi.fn(async (_id: string) => {}),
    onIntegrity: (l: (e: IntegrityEvent) => void) => (listeners.integrity.add(l), () => void listeners.integrity.delete(l)),
    onOpenFile: (l: (t: { snapshotId: string; path: string }) => void) => (listeners.openFile.add(l), () => void listeners.openFile.delete(l)),
    onSaved: () => () => {},
    openExternal: vi.fn(async (_url: string) => {}),
    copyText: vi.fn(async (_text: string) => {}),
    zipList: vi.fn(async (_id: string, _path: string) => ({ entries: [{ name: 'docs/', size: 0, compressedSize: 0, directory: true, modified: '2026-09-29T12:00:00.000Z' }, { name: 'docs/readme.txt', size: 12, compressedSize: 10, directory: false, modified: '2026-09-29T12:00:00.000Z' }], truncated: false })),
    zipExtract: vi.fn(async (_id: string, _path: string, _names: string[], _options?: { folder?: boolean }) => ({ extracted: 1, path: '/home/me/readme.txt', skipped: 0 })),
    copyFromPage: vi.fn(async (_id: string) => true),
    findInPage: vi.fn(async (_id: string, _query: string, _options: unknown) => ({ found: true, count: 3 })),
    clearFindInPage: vi.fn(async (_id: string) => {}),
    print: vi.fn(async (_request: unknown) => ({ printed: true as const })),
    savePdf: vi.fn(async (_request: unknown) => ({ saved: true as const, path: '/home/me/page.pdf' })),
    saveConverted: vi.fn(async (_id: string) => ({ saved: true as const, path: '/home/me/old.wsnp' })),
    selectAllInPage: vi.fn(async (_id: string) => {}),
    openWith: vi.fn(async (_id: string, _path: string): Promise<unknown> => ({ opened: true as const, chooser: true })),
    openWithApp: vi.fn(async (_token: string, _appId: string, _always: boolean): Promise<unknown> => ({ opened: true as const, chooser: true })),
    openWithCancel: vi.fn(async (_token: string) => {}),
    onPageContext: (l: (at: { snapshotId: string; x: number; y: number; hasSelection: boolean }) => void) => (listeners.pageContext.add(l), () => void listeners.pageContext.delete(l)),
    appInfo: vi.fn(async () => ({ name: 'Folder Browser', version: '1.2.3', electron: '44.5.0', chrome: '152.0', node: '24.1.0', platform: 'linux', arch: 'x64', licence: 'MIT', notices: '# Third-party notices\n\nreact 19 MIT' })),
    reveal: vi.fn(async (_id: string) => {}),
    recent: { list: vi.fn(async () => ['/home/me/a.wsnp']), clear: vi.fn(async () => {}) },
    session: { load: vi.fn(async () => storedSession), save: vi.fn(async (value: unknown) => void (storedSession = value)) },
    signers: { list: vi.fn(async (): Promise<Record<string, { name?: string }>> => ({})), trust: vi.fn(async (_fingerprint: string, _name?: string) => {}), forget: vi.fn(async (_fingerprint: string) => {}) },
  }
  const emit = {
    opened: (r: OpenResult[]) => act(() => listeners.opened.forEach((l) => l(r))),
    integrity: (e: IntegrityEvent) => act(() => listeners.integrity.forEach((l) => l(e))),
    command: (c: string) => act(() => listeners.command.forEach((l) => l(c))),
    pageContext: (at: { snapshotId: string; x: number; y: number; hasSelection: boolean }) => act(() => listeners.pageContext.forEach((l) => l(at))),
  }
  return { api: api as unknown as FbApi & typeof api, emit }
}
const ok = (id: string, title?: string, already = false, signature?: SnapshotInfo['signature']): OpenResult => ({ ok: true, snapshot: snapshotInfo(id, title, signature ? { signature } : {}), already })
const FP = 'ab'.repeat(32)
const signedBy = (): SnapshotInfo['signature'] => ({ state: 'valid', algorithm: 'Ed25519', publicKey: 'AAAA', fingerprint: FP, fingerprintShort: 'ABAB-ABAB-ABAB-ABAB-ABAB-ABAB-ABAB-ABAB' })

function show(initial: OpenResult[] = []) {
  const fake = fakeApi(initial)
  window.fb = fake.api
  render(<I18nProvider language="en"><Workbench /></I18nProvider>)
  return fake
}

beforeEach(() => {
  localStorage.clear()
  reloadLanguageSetting()
  reopenSession.reload()
  forgetReads()
  storedSession = null
})
afterEach(() => {
  cleanup()
  delete window.fb
})

describe('the workbench with snapshots', () => {
  it('opens what the command line named when the interface says it is ready, and checks its integrity', async () => {
    const { api } = show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(api.ready).toHaveBeenCalledOnce()
    expect(api.verify.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(screen.getByRole('listbox', { name: 'Open Snapshots' }).querySelectorAll('[role=option]')).toHaveLength(2)
  })
  it('shows each snapshot in an iframe with the sandbox and its own origin, and only the active one is visible', async () => {
    show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    const frames = document.querySelectorAll('iframe')
    expect([...frames].map((f) => f.getAttribute('src'))).toEqual(['wsnp://a/', 'wsnp://b/'])
    expect([...frames].every((f) => f.getAttribute('sandbox') === 'allow-scripts')).toBe(true)
    expect([...frames].map((f) => f.parentElement!.hidden)).toEqual([true, false])
    fireEvent.click(screen.getAllByRole('tab')[0])
    expect([...document.querySelectorAll('iframe')].map((f) => f.parentElement!.hidden)).toEqual([false, true])
  })
  it('a file opened from the system while the app runs gets its tab; the same file again only shows its tab', async () => {
    const { emit, api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await emit.opened([ok('b', 'Beta')])
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    await emit.opened([ok('a', 'Alpha', true)])
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Alpha')
    expect(api.verify.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })
  it('says why a file was refused, in plain words, and keeps the open ones', async () => {
    const { emit } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await emit.opened([{ ok: false, path: '/x/Bad.wsnp', issues: [{ code: 'not-zip' }], omitted: 0 }, { ok: false, path: '/x/Locked.wsnp', issues: [{ code: 'protected' }], omitted: 0 }])
    expect(screen.getByRole('alert').textContent).toContain('Could not open Bad.wsnp: This is not a WSNP file')
    expect(screen.getByRole('status').textContent).toContain('Locked.wsnp can’t be opened: It is password-protected')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('lets the main process release a snapshot when its tab closes', async () => {
    const { api, emit } = show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    await emit.command('closeEditor')
    await waitFor(() => expect(api.close).toHaveBeenCalledWith('b'))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })
  it('opens the picker from the menu, the shortcut and the button', async () => {
    const { api } = show()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Open File/ }))
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Open File' }))
    await waitFor(() => expect(api.openDialog).toHaveBeenCalledTimes(3))
  })
  it('opens a recent file from the File menu', async () => {
    const { api } = show()
    await waitFor(() => expect(api.recent.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Open Recent/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'a.wsnp' }))
    expect(api.openPaths).toHaveBeenCalledWith(['/home/me/a.wsnp'])
  })
  it('shows progress, then the result, of the integrity check, in the status bar and the Integrity view', async () => {
    const { emit } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await emit.integrity({ id: 'a', state: 'running', done: 50, total: 100 })
    expect(screen.getByRole('contentinfo').textContent).toContain('Checking 50%')
    await emit.integrity({ id: 'a', state: 'done', report: { checked: 7, bytes: 100, problems: [{ code: 'inline-script', path: 'index.html' }], aborted: false } })
    expect(screen.getByRole('contentinfo').textContent).toContain('1 problem')
    fireEvent.click(screen.getByRole('button', { name: 'Integrity' }))
    fireEvent.click(screen.getByRole('button', { name: 'index.html has a script written into the page.' }))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('index.html')]))
  })
  it('shows a file of the snapshot as source and offers Save As for one that cannot be shown', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getByRole('treeitem', { name: 'assets' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'files' }))
    // A ZIP is listed, not read into the interface; Save As is still on its toolbar.
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'bundle.zip' }))
    expect(await screen.findByRole('table', { name: /Files in the ZIP: bundle.zip/ })).toBeTruthy()
    expect(api.zipList).toHaveBeenCalledWith('a', 'assets/files/bundle.zip')
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    await waitFor(() => expect(api.saveFileAs).toHaveBeenCalledWith('a', 'assets/files/bundle.zip'))
    expect((await screen.findByRole('status')).textContent).toContain('Saved bundle.zip.')
  })
  it('holds back a snapshot whose files are not what the manifest says, until the user insists', async () => {
    const { emit } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    expect(document.querySelector('iframe')?.parentElement?.hidden).toBe(false)
    await emit.integrity({ id: 'a', state: 'done', report: { checked: 7, bytes: 100, problems: [{ code: 'hash-mismatch', path: 'assets/styles/site.css' }], aborted: false } })
    expect(screen.getByRole('alert').textContent).toContain('This snapshot is not valid')
    expect(screen.getByRole('alert').textContent).toContain('assets/styles/site.css')
    expect(document.querySelector('iframe')?.parentElement?.hidden).toBe(true)
    expect(screen.getByRole('contentinfo').textContent).toContain('Invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Show Anyway' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('iframe')?.parentElement?.hidden).toBe(false)
  })
  it('can close a snapshot that is not valid, or look at its metadata', async () => {
    const { emit, api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await emit.integrity({ id: 'a', state: 'done', report: { checked: 7, bytes: 100, problems: [{ code: 'size-mismatch', path: 'index.html' }], aborted: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Show Metadata' }))
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Metadata')
    fireEvent.click(screen.getAllByRole('tab')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Close Snapshot' }))
    await waitFor(() => expect(api.close).toHaveBeenCalledWith('a'))
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })
  it('shows the metadata of a snapshot in a tab: what the manifest says and what was checked', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Metadata' }))
    const view = screen.getByLabelText('Metadata')
    expect(view.textContent).toContain('PageKeep 1.5.0')
    expect(view.textContent).toContain('https://a.example/')
    expect(view.textContent).toContain('1280 × 800')
    expect(view.textContent).toContain('HTTP 404')
    expect(view.textContent).toContain('Not signed.')
    expect(screen.getByRole('navigation', { name: 'Breadcrumbs' }).textContent).toBe('AlphaMetadata')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Alpha', 'Metadata: Alpha'])
  })
  it('opens a file for a tab through the main process, and a link click can ask for one too', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getByRole('treeitem', { name: 'index.html' }))
    await waitFor(() => expect(api.readFile).toHaveBeenCalledWith('a', 'index.html'))
    expect(screen.getByRole('navigation', { name: 'Breadcrumbs' }).textContent).toBe('Alphaindex.html')
  })
  it('takes files dropped on the window by their path, and shows a hint while they are over it', async () => {
    const { api } = show()
    const file = new File(['x'], 'trip.wsnp')
    const data = { types: ['Files'], files: [file] }
    fireEvent(window, Object.assign(new Event('dragenter', { cancelable: true }), { dataTransfer: data }))
    expect(await screen.findByText('Drop .wsnp files to open them')).toBeTruthy()
    fireEvent(window, Object.assign(new Event('drop', { cancelable: true }), { dataTransfer: data }))
    await waitFor(() => expect(api.openPaths).toHaveBeenCalledWith(['/dropped/trip.wsnp']))
    expect(screen.queryByText('Drop .wsnp files to open them')).toBeNull()
  })
  it('handles the commands of the native menu and of the main process shortcuts', async () => {
    const { emit } = show([ok('a', 'Alpha'), ok('b', 'Beta'), ok('c', 'Gamma')])
    await screen.findAllByRole('tab')
    const active = () => screen.getByRole('tab', { selected: true }).textContent
    await emit.command('goToTab1')
    expect(active()).toContain('Alpha')
    await emit.command('nextEditor')
    expect(active()).toContain('Beta')
    await emit.command('previousEditor')
    expect(active()).toContain('Alpha')
    // Used last: Alpha, Beta, Gamma. Ctrl+Tab goes down that list, and letting go of Control makes the last one shown the most recent.
    await emit.command('cycleRecent')
    expect(active()).toContain('Beta')
    await emit.command('cycleRecent')
    expect(active()).toContain('Gamma')
    await emit.command('cycleEnd')
    await emit.command('cycleRecent')
    expect(active()).toContain('Alpha')
    await emit.command('cycleEnd')
    await emit.command('goToTab9')
    expect(active()).toContain('Gamma')
    await emit.command('toggleSideBar')
    expect(screen.getByRole('button', { name: 'Toggle Primary Side Bar' }).getAttribute('aria-pressed')).toBe('false')
  })
  it('says a snapshot is not signed, quietly, in the status bar and the metadata', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    expect(screen.getByRole('contentinfo').textContent).toContain('Not signed')
    fireEvent.click(screen.getByRole('button', { name: /Not signed/ }))
    expect(screen.getByLabelText('Metadata').textContent).toContain('if someone unzipped the file and edited the manifest')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('shows a signature that checks with a key the viewer does not know, and trusts it when the user says so, with a name', async () => {
    const { api } = show([ok('a', 'Alpha', false, signedBy())])
    await screen.findAllByRole('tab')
    expect(screen.getByRole('contentinfo').textContent).toContain('Signed (new key)')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Signed \(new key\)/ }))
    const view = screen.getByLabelText('Metadata')
    expect(view.textContent).toContain('Signed by a key this viewer does not know yet (ABAB-ABAB-ABAB-ABAB-ABAB-ABAB-ABAB-ABAB)')
    expect(view.textContent).toContain('Ed25519')
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'PageKeep at work' } })
    api.signers.list.mockResolvedValue({ [FP]: { name: 'PageKeep at work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trust this signer' }))
    await waitFor(() => expect(api.signers.trust).toHaveBeenCalledWith(FP, 'PageKeep at work'))
    await waitFor(() => expect(screen.getByLabelText('Metadata').textContent).toContain('Signed by PageKeep at work'))
    expect(screen.getByRole('contentinfo').textContent).toContain('Signed')
    expect(screen.getByRole('contentinfo').textContent).not.toContain('new key')
    api.signers.list.mockResolvedValue({})
    fireEvent.click(screen.getByRole('button', { name: 'Stop trusting' }))
    await waitFor(() => expect(api.signers.forget).toHaveBeenCalledWith(FP))
  })
  it('remembers the signers the user trusts, from the main process', async () => {
    const fake = fakeApi([ok('a', 'Alpha', false, signedBy())])
    fake.api.signers.list.mockResolvedValue({ [FP]: {} })
    window.fb = fake.api
    render(<I18nProvider language="en"><Workbench /></I18nProvider>)
    await screen.findAllByRole('tab')
    await waitFor(() => expect(screen.getByRole('contentinfo').textContent).toContain('Signed'))
    fireEvent.click(screen.getByRole('button', { name: /^Signed/ }))
    expect(screen.getByLabelText('Metadata').textContent).toContain('Signed by a key you trust (ABAB-')
  })
  it('holds back at once a snapshot whose manifest was edited after it was signed, and says why', async () => {
    show([ok('a', 'Alpha', false, { state: 'invalid', reason: 'manifest-mismatch' })])
    await screen.findAllByRole('tab')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('This snapshot is not valid')
    expect(alert.textContent).toContain('The metadata of the snapshot was edited after it was signed')
    expect(document.querySelector('iframe')?.parentElement?.hidden).toBe(true)
    expect(screen.getByRole('contentinfo').textContent).not.toContain('Signed')
  })
  it('opens Settings in a tab from the gear menu, the File menu, the shortcut and the status bar, once', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Settings/ }))
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Settings')
    expect(screen.getByRole('navigation', { name: 'Breadcrumbs' }).textContent).toBe('Settings')
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Preferences/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Settings/ }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })
  it('changes the theme and the language in Settings, at once; there is no zoom of the whole interface there', async () => {
    show()
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    fireEvent.change(screen.getByRole('combobox', { name: 'Color Theme' }), { target: { value: 'light' } })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.queryByRole('button', { name: 'Zoom In' })).toBeNull()
    expect(screen.queryByText('Zoom Level')).toBeNull()
  })
  it('shows the About window: the version, what it runs on, the licence, the notices and the links', async () => {
    const { api } = show()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About Folder Browser' }))
    const dialog = await screen.findByRole('dialog', { name: 'About Folder Browser' })
    expect(dialog.textContent).toContain('Version 1.2.3')
    expect(dialog.textContent).toContain('Electron 44.5.0, Chromium 152.0, Node 24.1.0, linux x64')
    expect(dialog.textContent).toContain('MIT License')
    expect(screen.queryByLabelText('Third-party notices')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show the notices/ }))
    expect(screen.getByLabelText('Third-party notices').textContent).toContain('react 19 MIT')
    fireEvent.click(screen.getByRole('button', { name: 'Source code and issues' }))
    fireEvent.click(screen.getByRole('button', { name: 'User guide' }))
    expect(api.openExternal.mock.calls.map((c) => c[0])).toEqual(['https://github.com/asantos43/folder-browser', 'https://github.com/asantos43/folder-browser/blob/main/docs/USER-GUIDE.md'])
    fireEvent.click(screen.getByRole('button', { name: 'Copy version information' }))
    expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining('Folder Browser 1.2.3'))
  })
  it('closes the About window with Escape, the button or a click outside, and keeps the focus inside while it is open', async () => {
    show()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About Folder Browser' }))
    const dialog = await screen.findByRole('dialog')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About Folder Browser' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About Folder Browser' }))
    const again = await screen.findByRole('dialog')
    fireEvent.keyDown(again, { key: 'Tab' })
    expect(again.contains(document.activeElement)).toBe(true)
    fireEvent.mouseDown(again.parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Copy, Find and Print', () => {
  // A menu item's name ends with its shortcut ("CopyCtrl+C").
  const editMenu = (name: string) => {
    if (!screen.queryByRole('menu', { name: 'Edit' })) fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    return within(screen.getByRole('menu', { name: 'Edit' })).getByRole('menuitem', { name: new RegExp(`^${name}`) }) as HTMLButtonElement
  }
  const openFile = async (...names: string[]) => {
    for (const name of names) {
      const item = screen.getByRole('treeitem', { name })
      if (item.getAttribute('aria-expanded') === 'false') fireEvent.click(item)
    }
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: names.at(-1)! }))
  }
  const findBox = () => screen.getByRole('textbox', { name: 'Find' })

  it('has Copy and Find off while nothing is open', async () => {
    show()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy())
    expect(editMenu('Copy').disabled).toBe(true)
    expect(editMenu('Find').disabled).toBe(true)
  })

  it('has Copy and Find on once a tab is open', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    expect(editMenu('Copy').disabled).toBe(false)
    expect(editMenu('Find').disabled).toBe(false)
  })

  it('finds text in the page of a snapshot: Ctrl+F opens the bar, typing asks the main process, Escape closes it and clears the page', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(findBox())
    fireEvent.change(findBox(), { target: { value: 'harbor' } })
    await waitFor(() => expect(api.findInPage).toHaveBeenCalledWith('a', 'harbor', { caseSensitive: false, backwards: false, reset: true, count: true }))
    expect(await screen.findByText('1 of 3')).toBeTruthy()
    fireEvent.keyDown(findBox(), { key: 'Enter' })
    expect(await screen.findByText('2 of 3')).toBeTruthy()
    fireEvent.keyDown(findBox(), { key: 'Escape' })
    expect(screen.queryByRole('search')).toBeNull()
    await waitFor(() => expect(api.clearFindInPage).toHaveBeenCalledWith('a'))
  })

  it('opens from the Edit menu and from the native menu, and closes when another tab comes to the front', async () => {
    const { emit } = show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    fireEvent.click(editMenu('Find'))
    expect(screen.getByRole('search')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('tab')[0])
    expect(screen.queryByRole('search')).toBeNull()
    await emit.command('find')
    expect(screen.getByRole('search')).toBeTruthy()
  })

  it('finds in the list of a ZIP (HTML of the interface), and says how many', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await openFile('assets', 'files', 'bundle.zip')
    await screen.findByRole('table')
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    fireEvent.change(findBox(), { target: { value: 'readme' } })
    expect(await screen.findByText('1 of 1')).toBeTruthy()
    fireEvent.change(findBox(), { target: { value: 'nothing like this' } })
    expect(await screen.findByText('No results')).toBeTruthy()
  })

  it('finds in a source file, over the whole text', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await openFile('assets', 'styles', 'site.css')
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('contents of assets/styles/site.css'))
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    fireEvent.change(findBox(), { target: { value: 'CONTENTS' } })
    expect(await screen.findByText('1 of 1')).toBeTruthy()
    expect(document.querySelectorAll('.cm-wsnpMatch')).toHaveLength(1)
  })

  it('closes the bar over a source file, with its button and with Escape, and the marks go', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await openFile('assets', 'styles', 'site.css')
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('contents of assets/styles/site.css'))
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    fireEvent.change(findBox(), { target: { value: 'contents' } })
    await screen.findByText('1 of 1')
    fireEvent.click(within(screen.getByRole('search')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('search')).toBeNull()
    expect(document.querySelectorAll('.cm-wsnpMatch')).toHaveLength(0)
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    fireEvent.change(findBox(), { target: { value: 'contents' } })
    await screen.findByText('1 of 1')
    fireEvent.keyDown(findBox(), { key: 'Escape' })
    expect(screen.queryByRole('search')).toBeNull()
  })

  it('does not offer Find on a picture', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await openFile('assets', 'images', 'logo.png')
    expect(editMenu('Find').disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(screen.queryByRole('search')).toBeNull()
  })

  it('copies what the page has selected by asking the page; other views copy their own selection', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(editMenu('Copy'))
    await waitFor(() => expect(api.copyFromPage).toHaveBeenCalledWith('a'))
    await openFile('assets', 'files', 'bundle.zip')
    await screen.findByRole('table')
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'picked text' } as unknown as Selection)
    fireEvent.click(editMenu('Copy'))
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith('picked text'))
    selection.mockReturnValue({ toString: () => '' } as unknown as Selection)
    fireEvent.click(editMenu('Copy'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(api.copyText).toHaveBeenCalledTimes(1)
    selection.mockRestore()
  })

  it('has Open File and Print on the activity bar; Print is off with nothing to print', async () => {
    const { api } = show()
    await waitFor(() => expect(api.recent.list).toHaveBeenCalled())
    const bar = screen.getByRole('navigation', { name: 'Activity Bar' })
    expect((within(bar).getByRole('button', { name: 'Print…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(bar).getByRole('button', { name: 'Open File…' }))
    await waitFor(() => expect(api.openDialog).toHaveBeenCalled())
  })

  it('prints the page of the snapshot from the activity bar, the menu and Ctrl+P', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    const bar = screen.getByRole('navigation', { name: 'Activity Bar' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Print…' }))
    await waitFor(() => expect(api.print).toHaveBeenLastCalledWith({ kind: 'snapshot', id: 'a' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'File' })).getByRole('menuitem', { name: /^Print/ }))
    await waitFor(() => expect(api.print).toHaveBeenCalledTimes(2))
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(api.print).toHaveBeenCalledTimes(3))
  })

  it('prints a text as the tab shows it, and a picture by its path; a ZIP cannot be printed', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await openFile('assets', 'styles', 'site.css')
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('contents of'))
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(api.print).toHaveBeenLastCalledWith({ kind: 'text', title: 'site.css', text: 'contents of assets/styles/site.css', name: 'site.css' }))
    await openFile('images', 'logo.png')
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(api.print).toHaveBeenLastCalledWith({ kind: 'image', id: 'a', path: 'assets/images/logo.png' }))
    await openFile('files', 'bundle.zip')
    await screen.findByRole('table')
    const bar = screen.getByRole('navigation', { name: 'Activity Bar' })
    expect((within(bar).getByRole('button', { name: 'Print…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says when printing failed, and says nothing when the user cancelled', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    api.print.mockResolvedValueOnce({ printed: false, reason: 'error', message: 'no printer' } as never)
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    expect((await screen.findByRole('alert')).textContent).toContain('Could not print: no printer')
    api.print.mockResolvedValueOnce({ printed: false, reason: 'cancelled' } as never)
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(api.print).toHaveBeenCalledTimes(2))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('Go Back, Go Forward, Go to File and the command palette', () => {
  const arrows = () => ({ back: screen.getByRole('button', { name: 'Go Back' }) as HTMLButtonElement, forward: screen.getByRole('button', { name: 'Go Forward' }) as HTMLButtonElement })
  const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent ?? ''

  it('walks back and forward through the tabs visited, with the arrows of the title bar and Alt+Left and Alt+Right', async () => {
    show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    expect(arrows().back.disabled).toBe(true)
    expect(arrows().forward.disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('tab')[0])
    expect(selectedTab()).toContain('Alpha')
    expect(arrows().back.disabled).toBe(false)
    fireEvent.click(arrows().back)
    expect(selectedTab()).toContain('Beta')
    expect(arrows().back.disabled).toBe(true)
    expect(arrows().forward.disabled).toBe(false)
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    expect(selectedTab()).toContain('Alpha')
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    expect(selectedTab()).toContain('Beta')
  })

  it('skips a tab that was closed, and forgets what was ahead when the user goes somewhere new', async () => {
    show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[0])
    fireEvent.click(arrows().back)
    fireEvent.click(screen.getAllByRole('tab')[0])
    expect(arrows().forward.disabled).toBe(true)
    expect(selectedTab()).toContain('Alpha')
  })

  it('opens Go to File from the box in the title bar, lists the tabs, and opens the file that was typed for', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getByRole('button', { name: /Folder Browser/ }))
    const dialog = screen.getByRole('dialog', { name: 'Go to File' })
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Alpha')])
    const box = within(dialog).getByRole('combobox')
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: 'logo' } })
    const options = within(dialog).getAllByRole('option')
    expect(options[0].textContent).toContain('logo.png')
    expect(options[0].textContent).toContain('Alpha › assets/images')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(selectedTab()).toContain('logo.png')
  })

  it('goes down and up the list with the arrows, and closes with Escape', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'css' } })
    const options = () => within(screen.getByRole('dialog')).getAllByRole('option')
    expect(options()[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.change(box, { target: { value: '.' } })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(options()[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(options()[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says when nothing matches', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'qqqqqq' } })
    expect(screen.getByText('No matching results')).toBeTruthy()
  })

  it('opens the command palette with Ctrl+Shift+P, runs a command of the menus by typing part of its name, and the themes are commands too', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true })
    const box = screen.getByRole('combobox') as HTMLInputElement
    expect(box.value).toBe('>')
    fireEvent.change(box, { target: { value: '>print' } })
    expect(within(screen.getByRole('dialog')).getAllByRole('option')[0].textContent).toMatch(/^Print…File/)
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(api.print).toHaveBeenCalledWith({ kind: 'snapshot', id: 'a' }))
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '>color theme light' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })

  it('has nothing to go to without a snapshot: Ctrl+E does nothing and the menu item is off; the palette still opens', async () => {
    show()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Go' })).toBeTruthy())
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go' }))
    expect((within(screen.getByRole('menu', { name: 'Go' })).getByRole('menuitem', { name: /^Go to File/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Go to File' })).toBeTruthy()
  })
})

describe('a ZIP saved by PageKeep', () => {
  const converted = { tool: 'Page Snapshot 1.0.0', warnings: ['script with src "https://x.example/a.js" removed'], omitted: 0, unrecorded: ['viewport', 'pixel-ratio', 'load-whole-page'] as ('viewport' | 'pixel-ratio' | 'load-whole-page')[] }
  const convertedResult = (): OpenResult => ({ ok: true, snapshot: snapshotInfo('z', 'Old page', { converted }), already: false })

  it('says it is shown converted and that the original is not changed, and offers Save as .wsnp', async () => {
    const { api } = show([convertedResult()])
    const bar = await screen.findByRole('region', { name: 'Details' })
    expect(bar.textContent).toContain('This is a ZIP saved by Page Snapshot 1.0.0, shown converted to a WSNP snapshot. The original file is not changed.')
    fireEvent.click(within(bar).getByRole('button', { name: 'Save as .wsnp…' }))
    await waitFor(() => expect(api.saveConverted).toHaveBeenCalledWith('z'))
    expect((await screen.findByRole('status')).textContent).toContain('Saved old.wsnp.')
  })

  it('lists what the conversion removed and what the ZIP did not record, under Details', async () => {
    show([convertedResult()])
    const bar = await screen.findByRole('region', { name: 'Details' })
    expect(within(bar).queryByText(/1 things had to be removed/)).toBeNull()
    fireEvent.click(within(bar).getByRole('button', { name: 'Details' }))
    expect(bar.textContent).toContain('does not record the size of the window')
    expect(bar.textContent).toContain('1 things had to be removed or could not be resolved:')
    expect(bar.textContent).toContain('script with src "https://x.example/a.js" removed')
  })

  it('can be saved as .wsnp from the File menu, which is off for an ordinary snapshot', async () => {
    const { api } = show([convertedResult()])
    await screen.findByRole('region', { name: 'Details' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'File' })).getByRole('menuitem', { name: 'Save as .wsnp…' }))
    await waitFor(() => expect(api.saveConverted).toHaveBeenCalledWith('z'))
    cleanup()
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    expect(screen.queryByRole('region', { name: 'Details' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    expect((within(screen.getByRole('menu', { name: 'File' })).getByRole('menuitem', { name: 'Save as .wsnp…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why the .wsnp could not be saved, and says nothing when the user cancelled', async () => {
    const { api } = show([convertedResult()])
    const bar = await screen.findByRole('region', { name: 'Details' })
    api.saveConverted.mockResolvedValueOnce({ saved: false, reason: 'error', message: 'did not pass the checks' } as never)
    fireEvent.click(within(bar).getByRole('button', { name: 'Save as .wsnp…' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save the .wsnp: did not pass the checks')
    api.saveConverted.mockResolvedValueOnce({ saved: false, reason: 'cancelled' } as never)
    fireEvent.click(within(bar).getByRole('button', { name: 'Save as .wsnp…' }))
    await waitFor(() => expect(api.saveConverted).toHaveBeenCalledTimes(2))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('Save as PDF and the menus of a right click', () => {
  const fileMenu = (name: RegExp) => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    return within(screen.getByRole('menu', { name: 'File' })).getByRole('menuitem', { name }) as HTMLButtonElement
  }
  const openFile = (...names: string[]) => {
    for (const name of names) {
      const item = screen.getByRole('treeitem', { name })
      if (item.getAttribute('aria-expanded') === 'false') fireEvent.click(item)
    }
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: names.at(-1)! }))
  }

  it('saves the page of the snapshot as a PDF from the File menu, and says where it went', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(fileMenu(/^Save as PDF/))
    await waitFor(() => expect(api.savePdf).toHaveBeenCalledWith({ kind: 'snapshot', id: 'a' }))
    expect((await screen.findByRole('status')).textContent).toContain('Saved page.pdf.')
  })

  it('an HTML file is saved as the page it is, a text file as the tab shows it, a picture as a picture; a ZIP cannot be', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    openFile('index.html')
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('contents of index.html'))
    fireEvent.click(fileMenu(/^Save as PDF/))
    await waitFor(() => expect(api.savePdf).toHaveBeenLastCalledWith({ kind: 'html', id: 'a', path: 'index.html' }))
    openFile('assets', 'styles', 'site.css')
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('contents of assets/styles/site.css'))
    fireEvent.click(fileMenu(/^Save as PDF/))
    // As the tab shows it: a stylesheet is laid out, so the text has its line ending.
    await waitFor(() => expect(api.savePdf).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'text', title: 'site.css', name: 'site.css', text: expect.stringContaining('contents of assets/styles/site.css') })))
    openFile('images', 'logo.png')
    fireEvent.click(fileMenu(/^Save as PDF/))
    await waitFor(() => expect(api.savePdf).toHaveBeenLastCalledWith({ kind: 'image', id: 'a', path: 'assets/images/logo.png' }))
    openFile('files', 'bundle.zip')
    await screen.findByRole('table')
    expect(fileMenu(/^Save as PDF/).disabled).toBe(true)
  })

  it('prints an HTML file as the page it is, too', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    openFile('index.html')
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('contents of index.html'))
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(api.print).toHaveBeenLastCalledWith({ kind: 'html', id: 'a', path: 'index.html' }))
  })

  it('says why the PDF could not be saved, and says nothing when the user cancelled', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    api.savePdf.mockResolvedValueOnce({ saved: false, reason: 'error', message: 'disk full' } as never)
    fireEvent.click(fileMenu(/^Save as PDF/))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save the PDF: disk full')
    api.savePdf.mockResolvedValueOnce({ saved: false, reason: 'cancelled' } as never)
    fireEvent.click(fileMenu(/^Save as PDF/))
    await waitFor(() => expect(api.savePdf).toHaveBeenCalledTimes(2))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('a right click in the page offers Select All, Copy, Print and Save as PDF, where the click was', async () => {
    const { api, emit } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await emit.pageContext({ snapshotId: 'a', x: 300, y: 200, hasSelection: true })
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.replace(/(Ctrl\+\w)$/, ''))).toEqual(['Select All', 'Copy', 'Print…', 'Save as PDF…'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Select All/ }))
    await waitFor(() => expect(api.selectAllInPage).toHaveBeenCalledWith('a'))
    await emit.pageContext({ snapshotId: 'a', x: 10, y: 10, hasSelection: true })
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Copy/ }))
    await waitFor(() => expect(api.copyFromPage).toHaveBeenCalledWith('a'))
    await emit.pageContext({ snapshotId: 'a', x: 10, y: 10, hasSelection: false })
    expect((within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Copy/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Print/ }))
    await waitFor(() => expect(api.print).toHaveBeenCalledWith({ kind: 'snapshot', id: 'a' }))
    await emit.pageContext({ snapshotId: 'a', x: 10, y: 10, hasSelection: false })
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Save as PDF/ }))
    await waitFor(() => expect(api.savePdf).toHaveBeenCalledWith({ kind: 'snapshot', id: 'a' }))
  })

  it('ignores a right click in a page that is not the one on screen', async () => {
    const { emit } = show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    await emit.pageContext({ snapshotId: 'a', x: 10, y: 10, hasSelection: false })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a right click in a text file offers Select All and Copy; Copy is off until there is a selection and then copies all of the text', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    openFile('assets', 'styles', 'site.css')
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('contents of assets/styles/site.css'))
    // (The stylesheet is being laid out: that replaces the text, and with it any selection.)
    await screen.findByText('Formatted')
    fireEvent.contextMenu(document.querySelector('.cm-content')!)
    let menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.replace(/(Ctrl\+\w)$/, ''))).toEqual(['Select All', 'Copy'])
    expect((within(menu).getByRole('menuitem', { name: /^Copy/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Select All/ }))
    fireEvent.contextMenu(document.querySelector('.cm-content')!)
    menu = await screen.findByRole('menu')
    expect((within(menu).getByRole('menuitem', { name: /^Copy/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Copy/ }))
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining('contents of assets/styles/site.css')))
  })
})

describe('reopening what was open', () => {
  const session = (tabs: object[], active = 0) => void (storedSession = { tabs, active })
  const showRestoring = () => {
    const fake = fakeApi()
    fake.api.openPaths.mockImplementation((async (paths: string[]) => paths.map((p): OpenResult => (p.includes('gone') ? { ok: false, path: p, issues: [{ code: 'not-zip' }], omitted: 0 } : ok(p.includes('b.wsnp') ? 'b' : 'a', p.includes('b.wsnp') ? 'Beta' : 'Alpha')))) as never)
    window.fb = fake.api
    render(<I18nProvider language="en"><Workbench /></I18nProvider>)
    return fake
  }

  it('opens the snapshots and files of the last session again, in their order, with the same tab in front', async () => {
    session([{ snapshot: '/home/me/a.wsnp', kind: 'page' }, { snapshot: '/home/me/a.wsnp', kind: 'file', file: 'assets/styles/site.css' }, { snapshot: '/home/me/b.wsnp', kind: 'page' }], 1)
    const { api } = showRestoring()
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3))
    expect(api.openPaths).toHaveBeenCalledWith(['/home/me/a.wsnp', '/home/me/b.wsnp'])
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([expect.stringContaining('Alpha'), expect.stringContaining('site.css'), expect.stringContaining('Beta')])
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('site.css')
    expect(api.verify).toHaveBeenCalledTimes(2)
  })

  it('says a file is gone, and still opens the rest', async () => {
    session([{ snapshot: '/home/me/gone.wsnp', kind: 'page' }, { snapshot: '/home/me/a.wsnp', kind: 'page' }, { snapshot: '/home/me/a.wsnp', kind: 'file', file: 'assets/styles/site.css' }], 2)
    showRestoring()
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('site.css')
    expect((await screen.findByRole('alert')).textContent).toContain('gone.wsnp')
  })

  it('opens what the command line asked for and nothing else', async () => {
    session([{ snapshot: '/home/me/b.wsnp', kind: 'page' }])
    const fake = fakeApi([ok('a', 'Alpha')])
    window.fb = fake.api
    render(<I18nProvider language="en"><Workbench /></I18nProvider>)
    await screen.findAllByRole('tab')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(fake.api.openPaths).not.toHaveBeenCalled()
  })

  it('does nothing when the setting is off, and then keeps nothing either', async () => {
    localStorage.setItem('fb:reopenSession', 'false')
    reopenSession.reload()
    session([{ snapshot: '/home/me/a.wsnp', kind: 'page' }])
    const { api } = showRestoring()
    await waitFor(() => expect(api.ready).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(api.openPaths).not.toHaveBeenCalled()
    await waitFor(() => expect(api.session.save).toHaveBeenCalledWith(null))
    expect(storedSession).toBeNull()
    localStorage.removeItem('fb:reopenSession')
    reopenSession.reload()
  })

  it('writes the tabs as they change, so the next start finds them', async () => {
    const { emit } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    const kept = () => storedSession as { tabs: unknown[]; active: number } | null
    await waitFor(() => expect(kept()).toMatchObject({ tabs: [{ snapshot: '/home/me/a.wsnp', kind: 'page' }], active: 0 }))
    await emit.opened([ok('b', 'Beta')])
    await waitFor(() => expect(kept()?.tabs).toHaveLength(2))
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true })
    await waitFor(() => expect(kept()?.tabs).toHaveLength(0))
  })

  it('has the setting in Settings, on by default', async () => {
    show()
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    const box = screen.getByRole('checkbox', { name: 'Reopen the files that were open' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(localStorage.getItem('fb:reopenSession')).toBe('false')
    localStorage.removeItem('fb:reopenSession')
    reopenSession.reload()
  })
})

describe('Open With…', () => {
  const openWithMenu = async (name: string) => {
    for (const folder of ['assets', 'files']) {
      const item = screen.getByRole('treeitem', { name: folder })
      if (item.getAttribute('aria-expanded') === 'false') fireEvent.click(item)
    }
    fireEvent.contextMenu(screen.getByRole('treeitem', { name }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Open With…' }))
  }

  it('asks the main process to hand the file to an application the system lets the user choose, and says nothing when it worked', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    await openWithMenu('report.pdf')
    await waitFor(() => expect(api.openWith).toHaveBeenCalledWith('a', 'assets/files/report.pdf'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says when there is no chooser and the default application was used, when the file is of a kind that could run, and when it failed; not when the user cancelled', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    api.openWith.mockResolvedValueOnce({ opened: true, chooser: false } as never)
    await openWithMenu('report.pdf')
    expect((await screen.findByRole('status')).textContent).toContain('report.pdf was opened with the default one')
    api.openWith.mockResolvedValueOnce({ opened: false, reason: 'unsafe' } as never)
    await openWithMenu('report.pdf')
    await waitFor(() => expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('is a kind of file that can run as a program'))).toBe(true))
    api.openWith.mockResolvedValueOnce({ opened: false, reason: 'error', message: 'no portal' } as never)
    await openWithMenu('report.pdf')
    expect((await screen.findByRole('alert')).textContent).toContain('Could not open report.pdf with another application: no portal')
    api.openWith.mockResolvedValueOnce({ opened: false, reason: 'cancelled' } as never)
    await openWithMenu('report.pdf')
    await waitFor(() => expect(api.openWith).toHaveBeenCalledTimes(4))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('Open With… on Linux: the viewer shows the choice itself', () => {
  const chooser = { token: 'tok', name: 'report.pdf', mime: 'application/pdf', mimeLabel: 'PDF document', apps: [{ id: 'evince.desktop', name: 'Document Viewer', recommended: true }, { id: 'edge.desktop', name: 'Microsoft Edge', recommended: false }] }
  const ask = async (api: ReturnType<typeof fakeApi>['api']) => {
    api.openWith.mockResolvedValueOnce({ choose: chooser })
    for (const folder of ['assets', 'files']) {
      const item = screen.getByRole('treeitem', { name: folder })
      if (item.getAttribute('aria-expanded') === 'false') fireEvent.click(item)
    }
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'report.pdf' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Open With…' }))
    return screen.findByRole('dialog', { name: 'Open With' })
  }

  it('shows the dialog in front of the window, and opens the application picked, asking for it to be the default when the switch is on', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    const dialog = await ask(api)
    expect(dialog.textContent).toContain('Choose an app to open report.pdf')
    fireEvent.click(within(dialog).getByRole('option', { name: 'Microsoft Edge' }))
    fireEvent.click(within(dialog).getByRole('switch'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(api.openWithApp).toHaveBeenCalledWith('tok', 'edge.desktop', true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.openWithCancel).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes the copy made for it when it is cancelled, and opens nothing', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    const dialog = await ask(api)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(api.openWithCancel).toHaveBeenCalledWith('tok'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.openWithApp).not.toHaveBeenCalled()
  })

  it('says when the application could not be started', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    const dialog = await ask(api)
    api.openWithApp.mockResolvedValueOnce({ opened: false, reason: 'error', message: 'gio: failed' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not open report.pdf with another application: gio: failed')
  })
})



describe('the zoom of a tab', () => {
  const frames = () => [...document.querySelectorAll('iframe')] as HTMLIFrameElement[]
  const zoomOfFrame = (f: HTMLIFrameElement) => f.style.transform
  const status = () => screen.getByRole('contentinfo').textContent ?? ''
  const key = (k: string) => fireEvent.keyDown(window, { key: k, ctrlKey: true })
  // (happy-dom's WheelEvent does not take the modifier keys of its init.)
  const wheelOf = (deltaY: number, ctrlKey = true) => {
    const e = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true })
    if (ctrlKey) Object.defineProperty(e, 'ctrlKey', { value: true })
    act(() => void window.dispatchEvent(e))
    return e
  }

  it('is not in the View menu, and nothing zooms the whole application', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    expect(within(screen.getByRole('menu', { name: 'View' })).queryByRole('menuitem', { name: /Zoom/ })).toBeNull()
  })

  it('zooms the page of the tab on screen with Ctrl+=, Ctrl+- and Ctrl+0: the frame is laid out at 1/zoom of the room and scaled up, and the status bar says it', async () => {
    const { api } = show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    expect(zoomOfFrame(frames()[0])).toBe('')
    expect(status()).toContain('100%')
    key('=')
    expect(zoomOfFrame(frames()[0])).toBe('scale(1.1)')
    expect(frames()[0].style.width).toBe(`${100 / 1.1}%`)
    expect(status()).toContain('110%')
    key('=')
    expect(status()).toContain('125%')
    key('-')
    key('-')
    key('-')
    expect(status()).toContain('90%')
    expect(frames()[0].style.transformOrigin).toMatch(/^0(px)? 0(px)?$/)
    key('0')
    expect(zoomOfFrame(frames()[0])).toBe('')
    expect(frames()[0].style.width).toBe('100%')
    expect(status()).toContain('100%')
    // Nothing of this reaches the main process: no window is zoomed.
    expect(api).not.toHaveProperty('setZoomLevel')
  })

  it('keeps the limits: 25 % and 500 %', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    for (let i = 0; i < 40; i++) key('=')
    expect(status()).toContain('500%')
    for (let i = 0; i < 60; i++) key('-')
    expect(status()).toContain('25%')
  })

  it('is the tab’s own: another snapshot is not zoomed, and each tab shows its own zoom in the status bar', async () => {
    show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    key('=')
    key('=')
    // The second tab is the one in front.
    expect(frames().map(zoomOfFrame)).toEqual(['', 'scale(1.25)'])
    fireEvent.click(screen.getAllByRole('tab')[0])
    expect(status()).toContain('100%')
    key('-')
    expect(frames().map(zoomOfFrame)).toEqual(['scale(0.9)', 'scale(1.25)'])
    expect(status()).toContain('90%')
    fireEvent.click(screen.getAllByRole('tab')[1])
    expect(status()).toContain('125%')
  })

  it('goes back to 100 % when the status bar item is clicked', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    key('=')
    fireEvent.click(screen.getByRole('button', { name: /110%/ }))
    expect(status()).toContain('100%')
    expect(zoomOfFrame(frames()[0])).toBe('')
  })

  it('has zoom buttons in the status bar, from 100 %, that move the same zoom as the keys and the wheel', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    const bar = within(screen.getByRole('contentinfo'))
    expect(bar.getByRole('group', { name: 'Zoom' })).toBeTruthy()
    expect(status()).toContain('100%')
    fireEvent.click(bar.getByRole('button', { name: 'Zoom In' }))
    expect(status()).toContain('110%')
    expect(zoomOfFrame(frames()[0])).toBe('scale(1.1)')
    key('=')
    expect(status()).toContain('125%')
    wheelOf(-100)
    expect(status()).toContain('150%')
    fireEvent.click(bar.getByRole('button', { name: 'Zoom Out' }))
    fireEvent.click(bar.getByRole('button', { name: 'Zoom Out' }))
    expect(status()).toContain('110%')
    fireEvent.click(bar.getByRole('button', { name: /110%/ }))
    expect(status()).toContain('100%')
  })

  it('disables the zoom button that would go past a limit', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    const bar = within(screen.getByRole('contentinfo'))
    for (let i = 0; i < 40; i++) key('=')
    expect((bar.getByRole('button', { name: 'Zoom In' }) as HTMLButtonElement).disabled).toBe(true)
    expect((bar.getByRole('button', { name: 'Zoom Out' }) as HTMLButtonElement).disabled).toBe(false)
    for (let i = 0; i < 60; i++) key('-')
    expect((bar.getByRole('button', { name: 'Zoom Out' }) as HTMLButtonElement).disabled).toBe(true)
    expect((bar.getByRole('button', { name: 'Zoom In' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('zooms with the wheel and Control: up goes in, down goes out, a notch a step; a wheel without Control scrolls', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    wheelOf(-100)
    wheelOf(-100)
    expect(status()).toContain('125%')
    wheelOf(100)
    expect(status()).toContain('110%')
    wheelOf(-100, false)
    expect(status()).toContain('110%')
    // Small turns of a trackpad add up to a step.
    for (let i = 0; i < 6; i++) wheelOf(-10)
    expect(status()).toContain('125%')
  })

  it('keeps Chromium from zooming the window by the wheel', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    expect(wheelOf(-100).defaultPrevented).toBe(true)
    expect(wheelOf(-100, false).defaultPrevented).toBe(false)
  })

  it('zooms the page that posts its own wheel and zoom keys (the script run in it): only the page on screen is heard, and only a message of its own frame', async () => {
    show([ok('a', 'Alpha'), ok('b', 'Beta')])
    await screen.findAllByRole('tab')
    const [frameA, frameB] = frames()
    const windows = [{}, {}] as Window[]
    Object.defineProperty(frameA, 'contentWindow', { value: windows[0], configurable: true })
    Object.defineProperty(frameB, 'contentWindow', { value: windows[1], configurable: true })
    const post = (source: Window | null, data: unknown) => act(() => void window.dispatchEvent(new MessageEvent('message', { data, source })))
    // Beta is the tab in front.
    await post(windows[1], { wsnp: 'wsnp-zoom', direction: 'in' })
    expect(status()).toContain('110%')
    await post(windows[1], { wsnp: 'wsnp-zoom', wheel: -100 })
    expect(status()).toContain('125%')
    await post(windows[1], { wsnp: 'wsnp-zoom', direction: 'reset' })
    expect(status()).toContain('100%')
    // The page that is behind, the interface itself, and what is not a zoom message are not heard.
    await post(windows[0], { wsnp: 'wsnp-zoom', direction: 'in' })
    await post(null, { wsnp: 'wsnp-zoom', direction: 'in' })
    await post(window, { wsnp: 'wsnp-zoom', direction: 'in' })
    await post(windows[1], { wsnp: 'other', direction: 'in' })
    await post(windows[1], 'in')
    expect(status()).toContain('100%')
    expect(frames().map(zoomOfFrame)).toEqual(['', ''])
  })

  it('zooms a source file: its text is drawn at the scale, and the page behind is not zoomed', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getByRole('treeitem', { name: 'assets' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'styles' }))
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'site.css' }))
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy())
    const box = () => document.querySelector('.cm-editor')!.closest('div[style]') as HTMLElement
    expect(box().style.getPropertyValue('--wsnp-zoom')).toBe('1')
    key('=')
    expect(box().style.getPropertyValue('--wsnp-zoom')).toBe('1.1')
    expect(status()).toContain('110%')
    expect(zoomOfFrame(frames()[0])).toBe('')
    key('0')
    expect(box().style.getPropertyValue('--wsnp-zoom')).toBe('1')
  })

  it('leaves a picture or a PDF to its own zoom: the keys step it, Ctrl+0 resets it, and the wheel is its own', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.click(screen.getByRole('treeitem', { name: 'assets' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'images' }))
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'logo.png' }))
    await screen.findByRole('toolbar')
    const own = { step: vi.fn(), reset: vi.fn() }
    const off = viewZoom.set(own)
    key('=')
    key('-')
    key('0')
    expect(own.step.mock.calls).toEqual([[1], [-1]])
    expect(own.reset).toHaveBeenCalledOnce()
    wheelOf(-100)
    expect(own.step).toHaveBeenCalledTimes(2)
    expect(status()).not.toContain('%')
    off()
  })

  it('has nothing to zoom in a ZIP’s list, the metadata or Settings, and does nothing there', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    key('=')
    expect(status()).not.toContain('%')
    expect(frames().map(zoomOfFrame)).toEqual([''])
  })

  it('forgets the zoom of a tab that is closed', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    key('=')
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true })
    await waitFor(() => expect(screen.queryAllByRole('tab')).toHaveLength(0))
    expect(status()).not.toContain('%')
  })

  it('is a command of the palette for the tab that can be zoomed, and not for one that cannot', async () => {
    show([ok('a', 'Alpha')])
    await screen.findAllByRole('tab')
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '>zoom in' } })
    const option = within(screen.getByRole('dialog')).getAllByRole('option')[0]
    expect(option.textContent).toContain('Zoom In')
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(status()).toContain('110%')
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true })
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox'), { target: { value: '>zoom in' } })
    expect(screen.getByText('No matching results')).toBeTruthy()
  })
})
