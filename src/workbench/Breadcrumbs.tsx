import { Icon } from '@/components/Icon.tsx'

/** The path of what the tab shows: `title › assets › images › logo.png`. */
export function Breadcrumbs({ trail }: { trail: string[] }) {
  return (
    <nav aria-label="Breadcrumbs" className="flex h-[22px] shrink-0 items-center gap-0.5 overflow-hidden bg-editor px-3 text-[13px] whitespace-nowrap text-crumb">
      {trail.map((part, i) => (
        <span key={i} className="flex min-w-0 items-center gap-0.5">
          {i > 0 ? <Icon name="chevron-right" className="shrink-0 text-[14px] opacity-70" /> : null}
          <span className={`truncate ${i === trail.length - 1 ? 'text-fg' : ''}`}>{part}</span>
        </span>
      ))}
    </nav>
  )
}
