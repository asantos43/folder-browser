import { describe, expect, it, vi } from 'vitest'
import { translator } from '@/i18n/index.ts'
import { sortMenuEntries } from './sortMenu.ts'

const t = translator('en')
const entries = (key: 'name' | 'modified' | 'size', descending: boolean, set = { key: vi.fn(), descending: vi.fn() }) => ({ list: sortMenuEntries(t, key, descending, set).filter((e) => !('separator' in e)) as { id: string; label: string; checked?: boolean; run?: () => void }[], set })

describe('sortMenuEntries', () => {
  it('offers the name, the date and the size, and the two ways, with the ones in use checked', () => {
    const { list } = entries('modified', true)
    expect(list.map((e) => e.label)).toEqual(['Name', 'Date Modified', 'Size', 'Ascending', 'Descending'])
    expect(list.map((e) => e.checked)).toEqual([false, true, false, false, true])
    expect(entries('name', false).list.map((e) => e.checked)).toEqual([true, false, false, true, false])
  })
  it('sets the key and the way, each by its own', () => {
    const { list, set } = entries('name', false)
    list.find((e) => e.id === 'size')!.run!()
    expect(set.key).toHaveBeenCalledWith('size')
    list.find((e) => e.id === 'descending')!.run!()
    expect(set.descending).toHaveBeenCalledWith(true)
    list.find((e) => e.id === 'ascending')!.run!()
    expect(set.descending).toHaveBeenLastCalledWith(false)
  })
  it('keeps the groups apart with one separator', () => {
    const all = sortMenuEntries(t, 'name', false, { key: vi.fn(), descending: vi.fn() })
    expect(all.filter((e) => 'separator' in e)).toHaveLength(1)
    expect('separator' in all[3]).toBe(true)
  })
})
