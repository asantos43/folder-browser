import { LANGUAGES, type Language } from '@core/filekind.ts'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { fuzzyScore } from '@/lib/fuzzy.ts'
import { fileLanguage, type ShownSource } from '@/state/fileLanguage.ts'

interface Item {
  id: string
  label: string
  description: string
  current: boolean
  choose: () => void
}

/**
 * VS Code's "Select Language Mode", from the status bar: a list of the languages the viewer can colour, to use when it took a file for the wrong one (an
 * `.inc` that is PHP, a script with no extension). The first entry goes back to what the viewer detects. The choice is for this file, while the window is open.
 */
export function LanguagePicker({ file, onClose }: { file: ShownSource; onClose: () => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])

  const items = useMemo(() => {
    const name = (language: Language) => t(`text.language.${language}` as MessageKey)
    const picked = fileLanguage.get(file.key)
    const all: Item[] = [
      { id: 'auto', label: t('languagePicker.auto'), description: name(file.detected), current: picked === undefined, choose: () => fileLanguage.set(file.key, undefined) },
      ...[...LANGUAGES]
        .sort((a, b) => (a === 'plain' ? -1 : b === 'plain' ? 1 : name(a).localeCompare(name(b))))
        .map((language): Item => ({ id: language, label: name(language), description: '', current: picked === language, choose: () => fileLanguage.set(file.key, language) })),
    ]
    const text = query.trim()
    return text ? all.filter((i) => fuzzyScore(text, i.label) !== null) : all
  }, [file, query, t])

  // (Effects that return nothing: a value returned from one is taken for its clean-up.)
  useEffect(() => {
    setAt(0)
  }, [query])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [at, items])

  const choose = (item: Item | undefined) => {
    if (!item) return
    onClose()
    item.choose()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') setAt((i) => Math.min(items.length - 1, i + 1))
    else if (event.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1))
    else if (event.key === 'Home') setAt(0)
    else if (event.key === 'End') setAt(Math.max(0, items.length - 1))
    else if (event.key === 'Enter') choose(items[at])
    else if (event.key === 'Escape') onClose()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="fixed inset-0 z-40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t('languagePicker.label')} className="mx-auto mt-[38px] w-[min(600px,calc(100vw-32px))] overflow-hidden rounded-md border border-widget-border bg-widget text-[13px] text-fg shadow-[0_0_8px_2px_var(--vscode-widget-shadow)]">
        <div className="p-1.5">
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="language-picker-list"
            aria-activedescendant={items[at] ? `language-picker-${at}` : undefined}
            aria-label={t('languagePicker.label')}
            placeholder={t('languagePicker.placeholder')}
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-[26px] w-full rounded-sm border border-group-border bg-editor px-2 text-fg outline-none placeholder:text-fg-muted focus:border-focus"
          />
        </div>
        <div ref={list} id="language-picker-list" role="listbox" aria-label={t('languagePicker.label')} className="max-h-[300px] overflow-auto pb-1">
          {items.length === 0 ? <div className="px-3 py-2 text-fg-muted">{t('quickOpen.none')}</div> : null}
          {items.map((item, i) => (
            <div
              key={item.id}
              id={`language-picker-${i}`}
              role="option"
              aria-selected={i === at}
              onMouseMove={() => setAt(i)}
              onClick={() => choose(item)}
              className={`mx-1 flex h-[24px] cursor-pointer items-center gap-2 rounded-[3px] px-2 ${i === at ? 'bg-list-active text-list-active-fg' : ''}`}
            >
              <span className="w-4 shrink-0">{item.current ? <Icon name="check" className="text-[16px]" /> : null}</span>
              <span className="truncate">{item.label}</span>
              <span className={`min-w-0 flex-1 truncate text-[12px] ${i === at ? 'opacity-80' : 'text-fg-muted'}`}>{item.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
