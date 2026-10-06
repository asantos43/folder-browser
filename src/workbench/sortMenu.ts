import type { SortKey } from '@core/fs/sort.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import type { Translate } from '@/i18n/index.ts'

/** The choices of how the files of a folder are ordered: by what, and which way. The button of the side bar and View ▸ Sort Files By both show these. */
export function sortMenuEntries(t: Translate, key: SortKey, descending: boolean, set: { key: (key: SortKey) => void; descending: (descending: boolean) => void }): MenuEntry[] {
  return [
    { id: 'name', label: t('sort.name'), checked: key === 'name', run: () => set.key('name') },
    { id: 'modified', label: t('sort.modified'), checked: key === 'modified', run: () => set.key('modified') },
    { id: 'size', label: t('sort.size'), checked: key === 'size', run: () => set.key('size') },
    { separator: true },
    { id: 'ascending', label: t('sort.ascending'), checked: !descending, run: () => set.descending(false) },
    { id: 'descending', label: t('sort.descending'), checked: descending, run: () => set.descending(true) },
  ]
}
