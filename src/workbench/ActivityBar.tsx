import { useCallback, useRef, useState } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { PrintIcon } from '@/components/PrintIcon.tsx'
import { MenuList, useDismiss, type MenuEntry } from '@/components/Menu.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { ThemeSetting } from '@/theme/theme.ts'
import { shortcut } from './commands.ts'

export type ViewId = 'snapshots'

const VIEWS: { id: ViewId; icon: string; label: 'activity.snapshots' }[] = [{ id: 'snapshots', icon: 'files', label: 'activity.snapshots' }]

/** The 48 px column of icons: the views at the top, the manage menu (theme) at the bottom. */
export function ActivityBar({ active, sideBarVisible, onSelect, theme, setTheme, onOpenSettings, onOpenFolder, onOpenZip, onPrint, canPrint }: { onOpenFolder: () => void; onOpenZip: () => void; onPrint: () => void; canPrint: boolean; active: ViewId; sideBarVisible: boolean; onSelect: (view: ViewId) => void; theme: ThemeSetting; setTheme: (t: ThemeSetting) => void; onOpenSettings: () => void }) {
  const { t } = useI18n()
  const [manage, setManage] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setManage(false), [])
  useDismiss(manage, ref, close)

  const themes: MenuEntry[] = [
    { id: 'settings', label: t('menu.settings'), shortcut: shortcut('Ctrl+,'), run: onOpenSettings },
    { separator: true },
    { id: 'auto', label: t('settings.themeAuto'), checked: theme === 'auto', run: () => setTheme('auto') },
    { id: 'dark', label: t('settings.themeDark'), checked: theme === 'dark', run: () => setTheme('dark') },
    { id: 'light', label: t('settings.themeLight'), checked: theme === 'light', run: () => setTheme('light') },
  ]

  return (
    <nav aria-label={t('activity.label')} className="flex w-12 shrink-0 flex-col justify-between bg-activity text-activity-fg">
      <div>
        {VIEWS.map((view) => {
          const selected = sideBarVisible && active === view.id
          return (
            <button
              key={view.id}
              type="button"
              title={t(view.label)}
              aria-label={t(view.label)}
              aria-pressed={selected}
              onClick={() => onSelect(view.id)}
              className={`relative flex h-12 w-12 items-center justify-center hover:text-activity-fg ${selected ? 'text-activity-fg' : 'text-activity-off'}`}
            >
              <Icon name={view.icon} className="text-[24px]" />
            </button>
          )
        })}
        <span role="separator" className="mx-3 my-1 block h-px bg-activity-off opacity-30" />
        <button type="button" title={`${t('activity.openFolder')} (${shortcut('Ctrl+Shift+O')})`} aria-label={t('activity.openFolder')} onClick={onOpenFolder} className="flex h-12 w-12 items-center justify-center text-activity-off hover:text-activity-fg">
          <Icon name="folder-opened" className="text-[24px]" />
        </button>
        <button type="button" title={t('activity.openZip')} aria-label={t('activity.openZip')} onClick={onOpenZip} className="flex h-12 w-12 items-center justify-center text-activity-off hover:text-activity-fg">
          <Icon name="file-zip" className="text-[24px]" />
        </button>
        <button type="button" title={`${t('activity.print')} (${shortcut('Ctrl+P')})`} aria-label={t('activity.print')} disabled={!canPrint} onClick={onPrint} className="flex h-12 w-12 items-center justify-center text-activity-off hover:text-activity-fg disabled:opacity-40 disabled:hover:text-activity-off">
          <PrintIcon className="text-[22px]" />
        </button>
      </div>
      <div ref={ref} className="relative">
        <button type="button" title={t('activity.manage')} aria-label={t('activity.manage')} aria-haspopup="menu" aria-expanded={manage} onClick={() => setManage(!manage)} className="flex h-12 w-12 items-center justify-center text-activity-off hover:text-activity-fg">
          <Icon name="settings-gear" className="text-[24px]" />
        </button>
        {manage ? (
          <div className="absolute bottom-2 left-12 z-50 text-[13px]">
            <MenuList entries={themes} label={t('settings.colorTheme')} onClose={close} />
          </div>
        ) : null}
      </div>
    </nav>
  )
}
