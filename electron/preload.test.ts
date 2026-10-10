import { beforeEach, expect, it, vi } from 'vitest'
import type { FbApi } from '../core/api.ts'

const electron = vi.hoisted(() => ({
  expose: vi.fn((_name: string, _api: FbApi) => {}), invoke: vi.fn(async (..._args: unknown[]) => undefined),
  on: vi.fn((_channel: string, _listener: (...args: unknown[]) => void) => {}), remove: vi.fn((_channel: string, _listener: (...args: unknown[]) => void) => {}),
  sync: vi.fn((channel: string) => channel === 'fb:keys-get' ? { entries: [], warnings: [] } : { values: {}, notices: [] }),
}))
// Only the renderer's Electron dependency is replaced; import the actual preload.
// Real process transport remains the separately reported Playwright acceptance.
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.remove, sendSync: electron.sync, send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() } }))
beforeEach(async () => { vi.clearAllMocks(); vi.resetModules(); await import('./preload.ts') })

it('exposes asynchronous plugin calls with the exact host channels and arguments', async () => {
  const [name, api] = electron.expose.mock.calls[0] as [string, FbApi]
  expect(name).toBe('fb')
  const options = { keepSettings: false }
  await api.plugins.list(); await api.plugins.install(); await api.plugins.installPaths(['/drop/sample.fbplugin'])
  await api.plugins.setEnabled('acme.sample', false); await api.plugins.remove('acme.sample', options)
  await api.plugins.disableAll(); await api.plugins.openFolder('acme.sample')
  expect(electron.invoke.mock.calls).toEqual([
    ['fb:plugins-list'], ['fb:plugins-install'], ['fb:plugins-install-paths', ['/drop/sample.fbplugin']],
    ['fb:plugins-set-enabled', 'acme.sample', false], ['fb:plugins-remove', 'acme.sample', options],
    ['fb:plugins-disable-all'], ['fb:plugins-open-folder', 'acme.sample'],
  ])
  expect(electron.sync.mock.calls.some(([channel]) => channel.startsWith('fb:plugins-'))).toBe(false)
  electron.invoke.mockRejectedValueOnce(new Error("Error invoking remote method 'fb:plugins-open-folder': Error: Choose an installed plugin."))
  await expect(api.plugins.openFolder('../bad')).rejects.toThrow(/^Choose an installed plugin\.$/)
})

it('onChange delivers the change and returns cancellation for the exact listener', () => {
  const api = electron.expose.mock.calls[0][1] as FbApi, listener = vi.fn()
  const cancel = api.plugins.onChange(listener)
  const [channel, wrapped] = electron.on.mock.calls.at(-1)!
  expect(channel).toBe('fb:plugins-changed')
  wrapped({ sender: 'event' }, undefined); expect(listener).toHaveBeenCalledWith()
  cancel(); expect(electron.remove).toHaveBeenCalledWith(channel, wrapped)
})
