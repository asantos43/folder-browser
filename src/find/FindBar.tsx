import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { NONE, type FindState, type FindTarget } from './types.ts'

/**
 * VS Code's find widget, at the top right of the editor: the text, match case, how many matches and which one, previous, next and
 * close. Enter goes to the next match, Shift+Enter to the previous, Escape closes. What it searches is the `target` of the tab on screen.
 * `focusToken` changes each time Ctrl+F is pressed, to put the cursor back in the box with its text selected.
 */
export function FindBar({ getTarget, focusToken, onClose }: { getTarget: () => FindTarget | null; focusToken: number; onClose: () => void }) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [state, setState] = useState<FindState>(NONE)
  const [busy, setBusy] = useState(false)
  // A search that is overtaken by a newer one (typing goes on) must not show its answer.
  const latest = useRef(0)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusToken])

  const run = async (work: (target: FindTarget) => FindState | Promise<FindState>) => {
    const mine = ++latest.current
    const target = getTarget()
    if (!target) return setState(NONE)
    setBusy(true)
    const next = await work(target)
    if (mine !== latest.current) return
    setBusy(false)
    setState(next)
  }

  // A new search, from the top, when the text or the case changes (a moment after the last key).
  useEffect(() => {
    const timer = setTimeout(() => void run((target) => target.search(query, { caseSensitive })), query ? 150 : 0)
    return () => clearTimeout(timer)
    // `run` only reads refs and the target's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive])

  // Closing lets go of the match marks, in whichever view they are.
  useEffect(() => () => getTarget()?.clear(), [getTarget])

  const step = (direction: 1 | -1) => query && void run((target) => target.step(direction))
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === 'F3') step(event.shiftKey ? -1 : 1)
    else if (event.key === 'Escape') onClose()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const noResults = Boolean(query) && !busy && state.count === 0
  const button = 'flex h-[22px] w-[22px] items-center justify-center rounded-sm hover:bg-toolbar-hover disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div data-find-skip role="search" aria-label={t('find.label')} className="absolute top-1 right-5 z-30 flex items-center gap-0.5 border border-widget-border bg-widget p-1 text-[13px] text-fg shadow-[0_0_8px_2px_var(--vscode-widget-shadow)]">
      <div className={`flex h-[24px] items-center rounded-sm border bg-editor ${noResults ? 'border-error' : 'border-group-border focus-within:border-focus'}`}>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('find.label')}
          placeholder={t('find.placeholder')}
          spellCheck={false}
          className="h-full w-[200px] bg-transparent px-1.5 text-fg outline-none placeholder:text-fg-muted"
        />
        <button type="button" title={t('find.matchCase')} aria-label={t('find.matchCase')} aria-pressed={caseSensitive} onClick={() => setCaseSensitive(!caseSensitive)} className={`mr-0.5 ${button} ${caseSensitive ? 'bg-toolbar-hover outline outline-1 outline-focus' : ''}`}>
          <Icon name="case-sensitive" className="text-[16px]" />
        </button>
      </div>
      <span aria-live="polite" className={`min-w-[84px] px-1.5 text-center ${noResults ? 'text-error' : 'text-fg-muted'}`}>
        {!query ? '' : busy ? t('find.searching') : state.count ? t('find.count', { index: state.index, total: state.count }) : t('find.none')}
      </span>
      <button type="button" title={t('find.previous')} aria-label={t('find.previous')} disabled={!state.count} onClick={() => step(-1)} className={button}>
        <Icon name="arrow-up" className="text-[16px]" />
      </button>
      <button type="button" title={t('find.next')} aria-label={t('find.next')} disabled={!state.count} onClick={() => step(1)} className={button}>
        <Icon name="arrow-down" className="text-[16px]" />
      </button>
      <button type="button" title={t('find.close')} aria-label={t('find.close')} onClick={onClose} className={button}>
        <Icon name="close" className="text-[16px]" />
      </button>
    </div>
  )
}
