import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { formatPercent, PRESETS, type ZoomMode } from './zoom.ts'

/** The toolbar of a viewer, under the breadcrumbs: 35 px, a row of small buttons as VS Code's editor toolbars. */
export function Toolbar({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div role="toolbar" aria-label={t('toolbar.label')} className="flex h-[35px] shrink-0 items-center gap-1 border-b border-group-border bg-editor px-2 text-[13px] text-fg">
      {children}
    </div>
  )
}

export function ToolbarButton({ icon, label, onClick, disabled, pressed, text }: { icon?: string; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; text?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[26px] min-w-[26px] items-center justify-center gap-1 rounded px-1 hover:bg-toolbar-hover disabled:opacity-40 disabled:hover:bg-transparent ${pressed ? 'bg-toolbar-hover' : ''}`}
    >
      {icon ? <Icon name={icon} className="text-[16px]" /> : null}
      {text ? <span>{text}</span> : null}
    </button>
  )
}

export const Separator = () => <span role="separator" aria-orientation="vertical" className="mx-1 h-4 w-px bg-group-border" />

const keyOf = (mode: ZoomMode): string => (typeof mode === 'number' ? String(mode) : mode)

/** The zoom controls: out, the choice box (fit modes and percentages), in, and what the scale is now. */
export function ZoomControls({ mode, scale, onMode, onStep, fitPage = true }: { mode: ZoomMode; scale: number; onMode: (mode: ZoomMode) => void; onStep: (direction: 1 | -1) => void; fitPage?: boolean }) {
  const { t } = useI18n()
  const presets = PRESETS.map((p) => keyOf(p))
  const current = keyOf(mode)
  return (
    <>
      <ToolbarButton icon="zoom-out" label={t('zoom.out')} onClick={() => onStep(-1)} />
      <select
        aria-label={t('zoom.level')}
        value={current}
        onChange={(e) => {
          const value = e.target.value
          onMode(value === 'auto' || value === 'fit-width' || value === 'fit-page' ? value : Number(value))
        }}
        className="h-[24px] rounded-sm border border-group-border bg-editor px-1 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus"
      >
        <option value="auto">{t('zoom.auto')}</option>
        <option value="fit-width">{t('zoom.fitWidth')}</option>
        {fitPage ? <option value="fit-page">{t('zoom.fitPage')}</option> : null}
        {typeof mode === 'number' && !presets.includes(current) ? <option value={current}>{formatPercent(mode)}</option> : null}
        {PRESETS.map((p) => (
          <option key={p} value={keyOf(p)}>
            {formatPercent(p)}
          </option>
        ))}
      </select>
      <ToolbarButton icon="zoom-in" label={t('zoom.in')} onClick={() => onStep(1)} />
      <span aria-live="polite" className="min-w-[44px] text-center tabular-nums text-fg-muted">
        {formatPercent(scale)}
      </span>
      <ToolbarButton text="1:1" label={t('zoom.actual')} onClick={() => onMode(1)} pressed={mode === 1} />
    </>
  )
}

export function SaveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <ToolbarButton icon="save-as" label={label} onClick={onClick} />
}
