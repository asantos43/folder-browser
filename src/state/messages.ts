import type { OpenResult } from '@core/api.ts'
import { UNSUPPORTED, type Issue } from '@core/validate/issues.ts'
import type { Translate } from '@/i18n/index.ts'
import { basename } from '@/lib/format.ts'

/** One issue in plain words. */
export const describeIssue = (t: Translate, issue: Issue): string => t(`issue.${issue.code}`, { path: issue.path ?? '', field: issue.field ?? '' })

export interface Notice {
  level: 'info' | 'error'
  text: string
}

/** What to tell the user about a file that was refused: the main reason, and how many others there were. */
export function refusalNotice(t: Translate, result: Extract<OpenResult, { ok: false }>): Notice {
  const [main, ...rest] = result.issues
  const others = rest.length + result.omitted
  const reason = describeIssue(t, main) + (others ? ` ${t(others === 1 ? 'notification.moreOne' : 'notification.more', { count: others })}` : '')
  const unsupported = UNSUPPORTED.includes(main.code)
  return { level: unsupported ? 'info' : 'error', text: t(unsupported ? 'notification.unsupported' : 'notification.refused', { name: basename(result.path), reason }) }
}
