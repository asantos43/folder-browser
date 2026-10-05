import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { MenuBar } from './MenuBar.tsx'
import { isMac, platform, shortcut, type Commands } from './commands.ts'

/**
 * The 30 px title bar. The window's own buttons stay native: on Windows and Linux the title bar overlay draws them at the
 * right, and `env(titlebar-area-*)` keeps this content clear of them; on macOS the traffic lights are at the left.
 */
export function TitleBar({ commands, sideBarVisible }: { commands: Commands; sideBarVisible: boolean }) {
  const { t } = useI18n()
  const mac = isMac()
  return (
    <header
      data-testid="titlebar"
      className="drag flex h-[30px] shrink-0 items-center bg-titlebar text-titlebar-fg"
      style={{
        paddingLeft: mac ? 78 : 'env(titlebar-area-x, 0px)',
        paddingRight: mac ? 0 : 'calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%))',
      }}
      data-platform={platform()}
    >
      {mac ? null : (
        <>
          <img src="./icon.svg" alt="" className="mx-2 h-4 w-4" />
          <MenuBar commands={commands} />
        </>
      )}
      {/* The whole bar drags the window: only the controls on it (the menu, the arrows, the search box, the side bar button) do not. */}
      <div className="flex h-full flex-1 items-center justify-center gap-1 px-2">
        <button type="button" disabled={!commands.canGoBack} onClick={commands.goBack} aria-label={t('titlebar.back')} title={`${t('titlebar.back')} (${isMac() ? '⌃-' : 'Alt+Left'})`} className="no-drag flex h-6 w-6 items-center justify-center rounded hover:bg-toolbar-hover disabled:opacity-40 disabled:hover:bg-transparent">
          <Icon name="arrow-left" />
        </button>
        <button type="button" disabled={!commands.canGoForward} onClick={commands.goForward} aria-label={t('titlebar.forward')} title={`${t('titlebar.forward')} (${isMac() ? '⌃⇧-' : 'Alt+Right'})`} className="no-drag flex h-6 w-6 items-center justify-center rounded hover:bg-toolbar-hover disabled:opacity-40 disabled:hover:bg-transparent">
          <Icon name="arrow-right" />
        </button>
        <button type="button" onClick={commands.quickOpen} title={`${t('titlebar.goToFile')} (${shortcut('Ctrl+E')})`} className="no-drag ml-1 flex h-[22px] w-full max-w-[38vw] items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/15 px-3 text-[12px] opacity-90 hover:bg-black/25">
          <Icon name="search" className="text-[14px]" />
          <span className="truncate">{t('titlebar.search')}</span>
        </button>
      </div>
      <div className="flex h-full items-center pr-2">
        <button
          type="button"
          aria-label={t('titlebar.toggleSideBar')}
          title={`${t('titlebar.toggleSideBar')} (${commandShortcut()})`}
          aria-pressed={sideBarVisible}
          onClick={commands.toggleSideBar}
          className="no-drag flex h-6 w-7 items-center justify-center rounded hover:bg-toolbar-hover"
        >
          <Icon name={sideBarVisible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} className="text-[16px]" />
        </button>
      </div>
    </header>
  )
}

const commandShortcut = () => (isMac() ? '⌘B' : 'Ctrl+B')
