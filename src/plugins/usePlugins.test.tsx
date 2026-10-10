// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginsProvider, usePlugins } from '@/plugins/usePlugins.tsx'
import type { PluginSummary, PluginsApi } from '@core/plugins/summary.ts'
afterEach(cleanup)
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
function Probe({ out }: { out: { items: PluginSummary[] } }) { out.items = usePlugins().items; return null }
function setup() {
  const pending: Array<(v: PluginSummary[]) => void> = []
  let active = 0, maxActive = 0
  const listeners = new Set<() => void>()
  const list = vi.fn(() => { active++; maxActive = Math.max(maxActive, active); return new Promise<PluginSummary[]>(res => pending.push(v => { active--; res(v) })) })
  const api = { list, onChange: (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb) } } as unknown as PluginsApi
  const out = { items: [] as PluginSummary[] }
  render(<PluginsProvider value={api}><Probe out={out} /></PluginsProvider>)
  return { list, pending, fire: () => listeners.forEach(l => l()), out, max: () => maxActive }
}
const p = (id: string) => ({ id } as PluginSummary)
it('refreshes once more after a change that arrives during a list() in flight', async () => {
  const s = setup()
  s.pending[0]!([p('a')]); await frame()
  s.fire(); await frame()            // second list() in flight
  expect(s.list).toHaveBeenCalledTimes(2)
  s.fire(); s.fire(); await frame()  // changes during flight
  expect(s.list).toHaveBeenCalledTimes(2)
  s.pending[1]!([p('b')]); await frame(); await frame()
  expect(s.list).toHaveBeenCalledTimes(3)
  s.pending[2]!([p('c')]); await frame()
  expect(s.out.items.map(i => i.id)).toEqual(['c'])
  expect(s.max()).toBe(1)
})
it('never runs two list() calls at once, even for a change during the first load', async () => {
  const s = setup()
  s.fire(); await frame()
  expect(s.max()).toBe(1)
})
