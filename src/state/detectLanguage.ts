import type { Language } from '@core/filekind.ts'

/** The text of a new text (Untitled) tells its language, before and without saving it: this reads only the start of it and answers `null` when nothing convinces (a wrong guess costs more than none). */
export const DETECT_THRESHOLD = 0.6
const HEAD = 65536

export type Detected = { language: Language; confidence: number }

const HTML_TAGS = new Set(['div', 'p', 'span', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'td', 'th', 'img', 'br', 'section', 'article', 'nav', 'button', 'form', 'input', 'script', 'style', 'header', 'footer', 'main', 'label', 'select', 'option', 'textarea'])

function shebang(head: string): Detected | null {
  const first = head.split('\n', 1)[0] ?? ''
  if (!first.startsWith('#!')) return null
  if (/\b(bash|zsh|sh|ksh|fish)\b/.test(first)) return { language: 'shell', confidence: 0.95 }
  if (/\bpython\d?\b/.test(first)) return { language: 'python', confidence: 0.95 }
  if (/\bnode\b/.test(first)) return { language: 'javascript', confidence: 0.95 }
  return null
}

function xml(head: string): Detected | null {
  const start = head.trimStart().slice(0, 200).toLowerCase()
  if (start.startsWith('<?xml')) return { language: 'xml', confidence: 0.95 }
  if (/^<svg[\s>]/.test(start)) return { language: 'xml', confidence: 0.9 }
  return null
}

function html(head: string): Detected | null {
  const lower = head.slice(0, 4096).toLowerCase()
  if (/<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/.test(lower)) return { language: 'html', confidence: 0.95 }
  if (!head.trimStart().startsWith('<')) return null
  // A fragment: several known tags near the start.
  let tags = 0
  for (const m of lower.matchAll(/<\/?([a-z][a-z0-9]*)[\s>/]/g)) {
    if (HTML_TAGS.has(m[1]!)) tags += 1
    if (tags >= 3) return { language: 'html', confidence: 0.75 }
  }
  return null
}

function jsonValue(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}

function json(head: string, whole: boolean): Detected | null {
  const trimmed = head.trim()
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return null
  if (whole && jsonValue(trimmed)) return { language: 'json', confidence: 0.95 }
  // JSON lines: every one of the first lines is an object or an array.
  const lines = trimmed.split('\n').filter((l) => l.trim() !== '').slice(0, 20)
  if (lines.length >= 2 && lines.every((l) => (l.trim().startsWith('{') || l.trim().startsWith('[')) && jsonValue(l))) return { language: 'json', confidence: 0.85 }
  // A text cut at the limit: the start has the shape of JSON ("key": value) in its first lines.
  if (!whole) {
    const body = trimmed.split('\n').slice(1, 6)
    if (/^[{[]\s*"/.test(trimmed) || (first === '[' && /^\[\s*[{\d"]/.test(trimmed))) {
      if (body.length >= 3 && body.filter((l) => /^\s*"[^"\\]*"\s*:\s*\S/.test(l) || /^\s*[{[]/.test(l)).length >= 3) return { language: 'json', confidence: 0.65 }
    }
  }
  return null
}

function dockerfile(head: string): Detected | null {
  const line = head.split('\n').find((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
  return line !== undefined && /^FROM\s+\S/.test(line) ? { language: 'dockerfile', confidence: 0.9 } : null
}

function markdown(head: string): Detected | null {
  let headings = 0
  let lists = 0
  let fences = 0
  let links = 0
  for (const line of head.split('\n', 400)) {
    if (/^#{1,6}\s+\S/.test(line)) headings += 1
    else if (/^\s*([-*+]|\d+\.)\s+\S/.test(line)) lists += 1
    if (/^\s*```/.test(line)) fences += 1
    if (/\]\(\S+\)/.test(line)) links += 1
  }
  const score = headings * 2 + lists + fences * 2 + links
  if (score >= 5 && (headings >= 1 || fences >= 2)) return { language: 'markdown', confidence: Math.min(0.9, 0.5 + score * 0.05) }
  return null
}

function yaml(head: string): Detected | null {
  const lines = head.split('\n', 60).map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  if (lines.length === 0) return null
  const pair = /^\s*-?\s*[\w.-]+:(\s+\S.*)?$/
  const prose = (l: string) => /[.!?]$/.test(l) || (l.split(':', 1)[0] ?? '').trim().split(/\s+/).length > 8
  if (lines[0] === '---') {
    return lines.slice(1, 11).filter((l) => pair.test(l) && !prose(l)).length >= 2 ? { language: 'yaml', confidence: 0.85 } : null
  }
  const first = lines.slice(0, 10)
  const matching = first.filter((l) => pair.test(l) && !prose(l))
  return matching.length >= 3 && matching.length >= first.length * 0.6 ? { language: 'yaml', confidence: 0.7 } : null
}

export function detectLanguage(text: string): Detected | null {
  if (text.length === 0) return null
  const head = text.length > HEAD ? text.slice(0, HEAD) : text
  if (head.trim() === '') return null
  const whole = text.length <= HEAD
  const found = shebang(head) ?? xml(head) ?? html(head) ?? json(head, whole) ?? dockerfile(head) ?? markdown(head) ?? yaml(head)
  return found !== null && found.confidence >= DETECT_THRESHOLD ? found : null
}
