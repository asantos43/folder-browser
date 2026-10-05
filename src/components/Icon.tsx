/** A Codicon (VS Code's icon font). Decorative unless it has a `label`. */
export function Icon({ name, label, className = '' }: { name: string; label?: string; className?: string }) {
  return <span className={`codicon codicon-${name} ${className}`} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} />
}
