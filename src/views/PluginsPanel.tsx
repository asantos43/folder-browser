import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { Icon } from '@/components/Icon.tsx'
import { ChoiceDialog } from '@/components/ChoiceDialog.tsx'
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx'
import { formatBytes } from '@/lib/format.ts'
import { normalizeSearch } from './SettingsView.tsx'
import { usePlugins } from '@/plugins/usePlugins.tsx'
import type { PluginContributes, PluginSummary, TrustLabel } from '@core/plugins/summary.ts'

const control = 'h-[26px] rounded-sm border border-group-border bg-editor px-2 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus'
const linkButton = `${control} text-link hover:underline focus-visible:outline-1 focus-visible:outline-focus outline-none`
const ROW_HEIGHT = 132
const OVERSCAN = 5
// Hard cap on the host error text shown in a row (the row is 132 px tall). Long errors
// still appear in full on the row's `title` attribute so screen readers and on-hover tooltips
// keep every character.
const ERROR_LIMIT = 300

/** Cut a host string at a code-point boundary so RTL / surrogate pairs stay whole. */
function truncate(text: string, limit: number): { visible: string; truncated: boolean } {
  if (text.length <= limit) return { visible: text, truncated: false }
  const cut = Array.from(text).slice(0, limit).join('')
  return { visible: cut + '…', truncated: true }
}

interface TrustInfo { key: MessageKey; icon: string; className: string }
const TRUST: Record<TrustLabel, TrustInfo> = {
  catalog: { key: 'plugins.trust.catalog', icon: 'verified', className: 'text-link' },
  'signed-trusted': { key: 'plugins.trust.signed-trusted', icon: 'shield', className: 'text-link' },
  'signed-unknown': { key: 'plugins.trust.signed-unknown', icon: 'shield', className: 'text-error' },
  repository: { key: 'plugins.trust.repository', icon: 'repo', className: 'text-fg-muted' },
  unsigned: { key: 'plugins.trust.unsigned', icon: 'warning', className: 'text-error' },
}

function contributeParts(c: PluginContributes, t: ReturnType<typeof useI18n>['t']): string[] {
  const parts: string[] = []
  if (c.themes) parts.push(c.themes === 1 ? t('plugins.contributes.themesOne') : t('plugins.contributes.themes', { count: c.themes }))
  if (c.keymaps) parts.push(c.keymaps === 1 ? t('plugins.contributes.keymapsOne') : t('plugins.contributes.keymaps', { count: c.keymaps }))
  if (c.languages) parts.push(c.languages === 1 ? t('plugins.contributes.languagesOne') : t('plugins.contributes.languages', { count: c.languages }))
  if (c.locales) parts.push(c.locales === 1 ? t('plugins.contributes.localesOne') : t('plugins.contributes.locales', { count: c.locales }))
  if (c.openWith) parts.push(c.openWith === 1 ? t('plugins.contributes.openWithOne') : t('plugins.contributes.openWith', { count: c.openWith }))
  if (c.commands) parts.push(c.commands === 1 ? t('plugins.contributes.commandsOne') : t('plugins.contributes.commands', { count: c.commands }))
  if (c.settings) parts.push(c.settings === 1 ? t('plugins.contributes.settingsOne') : t('plugins.contributes.settings', { count: c.settings }))
  return parts
}

function matches(plugin: PluginSummary, needle: string): boolean {
  if (!needle) return true
  return normalizeSearch(`${plugin.name} ${plugin.id} ${plugin.publisher.name} ${plugin.publisher.id}`).includes(needle)
}

interface RowProps {
  plugin: PluginSummary
  top: number
  actionError: string | null
  onToggle: (plugin: PluginSummary, enabled: boolean) => void
  onRemove: (plugin: PluginSummary) => void
  onOpenFolder: (plugin: PluginSummary) => void
  onSettings: (id: string) => void
  busy: boolean
}

const PluginRow = memo(function PluginRow({ plugin, top, actionError, onToggle, onRemove, onOpenFolder, onSettings, busy }: RowProps) {
  const { t } = useI18n()
  const trust = TRUST[plugin.trust]
  const parts = useMemo(() => contributeParts(plugin.contributes, t), [plugin.contributes, t])
  const contributesText = parts.length ? t('plugins.contributes', { summary: parts.join(', ') }) : t('plugins.contributes.none')
  const toggleDisabled = plugin.hasCode || busy
  const toggleLabel = plugin.enabled ? t('plugins.toggleDisable', { name: plugin.name }) : t('plugins.toggleEnable', { name: plugin.name })
  const rowStyle: CSSProperties = { position: 'absolute', top, left: 0, right: 0, height: ROW_HEIGHT }
  const showSettingsButton = plugin.contributes.settings > 0
  const error = plugin.error ? truncate(plugin.error, ERROR_LIMIT) : null
  return (
    <div
      role="listitem"
      data-plugin-id={plugin.id}
      data-trust={plugin.trust}
      className="flex flex-col gap-1 border-b border-group-border px-4 py-3"
      style={rowStyle}
    >
      <div className="flex items-center gap-3">
        <strong className="min-w-0 flex-1 truncate text-[14px]" title={plugin.name}><bdi>{plugin.name}</bdi></strong>
        <span className="shrink-0 text-[12px] text-fg-muted"><bdi>{plugin.version}</bdi></span>
        <button
          type="button"
          role="switch"
          aria-checked={plugin.enabled}
          aria-label={toggleLabel}
          title={plugin.hasCode ? t('plugins.hasCodeHint') : undefined}
          disabled={toggleDisabled}
          onClick={() => onToggle(plugin, !plugin.enabled)}
          className={`${control} w-[52px] text-center ${plugin.enabled ? 'bg-button text-button-fg hover:bg-button-hover' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {plugin.enabled ? t('plugins.on') : t('plugins.off')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-muted">
        <span><bdi>{t('plugins.publisher', { publisher: plugin.publisher.name })}</bdi></span>
        <span aria-hidden>·</span>
        <span className={`inline-flex items-center gap-1 ${trust.className}`}>
          <Icon name={trust.icon} aria-hidden />
          <span><bdi>{t(trust.key)}</bdi></span>
        </span>
        <span aria-hidden>·</span>
        <span><bdi>{formatBytes(plugin.sizeBytes)}</bdi></span>
        <span aria-hidden>·</span>
        <span className="min-w-0 flex-1 truncate" title={contributesText}><bdi>{contributesText}</bdi></span>
      </div>
      {plugin.description ? <p className="m-0 line-clamp-1 text-[12px] text-fg-muted"><bdi>{plugin.description}</bdi></p> : null}
      {plugin.hasCode ? <p className="m-0 text-[12px] text-error"><Icon name="code" aria-hidden /> <bdi>{t('plugins.hasCode')}</bdi></p> : null}
      {error ? <p role="alert" className="m-0 line-clamp-1 text-[12px] text-error" title={plugin.error}><bdi>{t('plugins.error', { message: error.visible })}</bdi></p> : null}
      {actionError ? <p role="alert" className="m-0 line-clamp-1 text-[12px] text-error" title={actionError}><bdi>{actionError}</bdi></p> : null}
      <div className="mt-auto flex flex-wrap gap-2">
        {showSettingsButton ? <button type="button" className={linkButton} onClick={() => onSettings(plugin.id)}>{t('plugins.settings')}</button> : null}
        <button type="button" className={linkButton} onClick={() => onOpenFolder(plugin)}>{t('plugins.openFolder')}</button>
        <button type="button" className={linkButton} onClick={() => onRemove(plugin)}>{t('plugins.remove')}</button>
      </div>
    </div>
  )
})

export interface PluginsPanelProps {
  /** Switch to the General section and filter by the plugin's id (its settings). */
  onJumpToSettings?: (pluginId: string) => void
}

export function PluginsPanel({ onJumpToSettings }: PluginsPanelProps = {}) {
  const { t } = useI18n()
  const { available, items, loading, actions } = usePlugins()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const needle = useMemo(() => normalizeSearch(deferred.trim()), [deferred])
  const visible = useMemo(() => items.filter(item => matches(item, needle)), [items, needle])
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<PluginSummary | null>(null)
  const [confirmingDisableAll, setConfirmingDisableAll] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [disableAllError, setDisableAllError] = useState<string | null>(null)
  // Short, accessible message shown on the row when a toggle / open-folder action fails.
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setContainerHeight(el.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setContainerHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const visibleRows = containerHeight > 0 ? Math.ceil(containerHeight / ROW_HEIGHT) : 6
  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT)
  const first = Math.max(0, firstVisible - OVERSCAN)
  const last = Math.min(visible.length, firstVisible + visibleRows + OVERSCAN)
  // `rowWindow` is the slice of `visible` rendered in the viewport. Each item is positioned
  // at its absolute top: `first + index` keeps the offset inside the original list, so a
  // scroll bar that doesn't reach the top still aligns rows correctly.
  const rowWindow = visible.slice(first, last)
  const anyEnabled = useMemo(() => items.some(item => item.enabled), [items])
  const anyDeveloper = useMemo(() => items.some(item => item.developer), [items])

  if (!available) {
    return <p role="region" aria-label={t('plugins.title')} className="text-fg-muted">{t('plugins.notAvailable')}</p>
  }

  const handleToggle = async (plugin: PluginSummary, enabled: boolean) => {
    setBusy(true)
    try {
      await actions.setEnabled(plugin.id, enabled)
      setActionErrors(prev => { const next = { ...prev }; delete next[plugin.id]; return next })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setActionErrors(prev => ({ ...prev, [plugin.id]: t('plugins.toggleFailed', { name: plugin.name, message }) }))
    } finally {
      setBusy(false)
    }
  }
  const handleRemove = async (plugin: PluginSummary, keep: boolean) => {
    setBusy(true)
    try {
      await actions.remove(plugin.id, { keepSettings: keep })
      setActionErrors(prev => { const next = { ...prev }; delete next[plugin.id]; return next })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setActionErrors(prev => ({ ...prev, [plugin.id]: t('plugins.removeFailed', { name: plugin.name, message }) }))
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }
  const handleOpenFolder = async (plugin: PluginSummary) => {
    try {
      await actions.openFolder(plugin.id)
      setActionErrors(prev => { const next = { ...prev }; delete next[plugin.id]; return next })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setActionErrors(prev => ({ ...prev, [plugin.id]: t('plugins.openFolderFailed', { message }) }))
    }
  }
  const handleSettings = (id: string) => { onJumpToSettings?.(id) }
  const handleInstall = async () => {
    let result
    try {
      result = await actions.install()
    } catch (cause) {
      // The host promise rejected: show the message in plain words; no further state changes.
      setInstallError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    if ('cancelled' in result) return
    if (!result.ok) setInstallError(result.message)
    else setInstallError(null) // a fresh install that succeeds clears any previous error
  }
  const handleDisableAll = async () => {
    setBusy(true)
    try {
      await actions.disableAll()
      setDisableAllError(null)
    } catch (cause) {
      setDisableAllError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setConfirmingDisableAll(false)
    }
  }

  return (
    <section role="region" aria-label={t('plugins.title')} className="flex flex-col">
      <h2 className="m-0 mb-3 border-b border-group-border pb-1 text-[13px] font-bold uppercase text-fg-muted">{t('plugins.title')}</h2>
      <p className="m-0 mb-3 text-[13px] text-fg-muted">{t('plugins.intro')}</p>
      <div role="toolbar" aria-label={t('plugins.title')} className="mb-3 flex flex-wrap gap-2">
        <button type="button" className={control} onClick={handleInstall}>{t('plugins.install')}</button>
        <button type="button" className={control} disabled={!anyEnabled || busy} onClick={() => setConfirmingDisableAll(true)}>{t('plugins.disableAll')}</button>
      </div>
      <input type="search" aria-label={t('plugins.search')} placeholder={t('plugins.search')} value={query} onChange={event => setQuery(event.target.value)} className={`${control} mb-3 w-full`} />
      {anyDeveloper ? <p role="status" aria-live="polite" className="mb-3 border border-group-border bg-widget p-2 text-[12px] text-fg-muted">{t('plugins.developerMode')}</p> : null}
      {installError ? <p role="alert" className="mb-3 text-[13px] text-error"><bdi>{t('plugins.installFailed', { message: installError })}</bdi></p> : null}
      {disableAllError ? <p role="alert" className="mb-3 text-[13px] text-error"><bdi>{t('plugins.disableAllFailed', { message: disableAllError })}</bdi></p> : null}
      {visible.length === 0
        ? <p className="text-fg-muted">{items.length ? t('settings.noMatch', { query: deferred }) : t('plugins.empty')}</p>
        : <div
            ref={box}
            role="list"
            aria-label={t('plugins.title')}
            aria-busy={loading}
            onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
            className="relative h-[60vh] overflow-y-auto border border-group-border bg-editor"
          >
            <div style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}>
              {rowWindow.map((plugin, index) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  top={(first + index) * ROW_HEIGHT}
                  actionError={actionErrors[plugin.id] ?? null}
                  onToggle={handleToggle}
                  onRemove={plugin => setRemoving(plugin)}
                  onOpenFolder={handleOpenFolder}
                  onSettings={handleSettings}
                  busy={busy}
                />
              ))}
            </div>
          </div>}
      {removing ? <ChoiceDialog
        title={t('plugins.removeTitle', { name: removing.name })}
        message={t('plugins.removeMessage')}
        choices={[
          // Keep is the default for an uninstall: the user can always come back and
          // remove their settings later, but a one-shot delete here is harder to undo.
          { label: t('plugins.removeKeep'), primary: true, run: () => { void handleRemove(removing, true) } },
          { label: t('plugins.removeDelete'), run: () => { void handleRemove(removing, false) } },
        ]}
        onCancel={() => setRemoving(null)}
      /> : null}
      {confirmingDisableAll ? <ConfirmDialog
        danger
        title={t('plugins.disableAll')}
        message={t('plugins.disableAllConfirm')}
        confirmLabel={t('plugins.disableAll')}
        onCancel={() => setConfirmingDisableAll(false)}
        onConfirm={handleDisableAll}
      /> : null}
    </section>
  )
}