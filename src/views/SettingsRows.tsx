import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SettingDefinition } from '@core/settings/registry.ts'

/** Keep controls near the viewport mounted; placeholders retain measured row heights. */
export function SettingsRows({ definitions, children }: { definitions: SettingDefinition[]; children: (definition: SettingDefinition) => ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [mounted, setMounted] = useState(() => new Set(definitions.slice(0, 40).map(d => d.id)))
  useEffect(() => {
    if (definitions.length <= 40 || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      setMounted(previous => {
        const next = new Set(previous)
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.setting!
          if (entry.isIntersecting || entry.target.contains(document.activeElement)) next.add(id)
          else {
            const height = entry.target.getBoundingClientRect().height
            if (height > 0) heights.current.set(id, height)
            next.delete(id)
          }
        }
        return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next
      })
    }, { root: root.current?.closest('[data-settings-page]'), rootMargin: '500px' })
    root.current?.querySelectorAll('[data-setting]').forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [definitions])
  return <div ref={root}>{definitions.map(definition => <div key={definition.id} data-setting={definition.id} style={definitions.length <= 40 || mounted.has(definition.id) ? undefined : { height: heights.current.get(definition.id) ?? 112 }}>
    {definitions.length <= 40 || mounted.has(definition.id) ? children(definition) : null}
  </div>)}</div>
}
