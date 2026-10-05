import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { describeIssue } from '@/state/messages.ts'
import type { IntegrityState } from '@/state/workspace.ts'

/** The result of reading every file: progress, "intact", or the files that changed, each a link to the file. */
export function IntegrityPanel({ state, onOpenFile }: { state: IntegrityState | undefined; onOpenFile: (path: string) => void }) {
  const { t } = useI18n()
  if (!state) return <p className="m-0 text-fg-muted">{t('integrity.notStarted')}</p>
  if (state.state === 'running') {
    const percent = state.total ? Math.min(100, Math.floor((state.done / state.total) * 100)) : 0
    return (
      <div>
        <p className="m-0 mb-1 text-fg-muted">{t('integrity.running', { percent })}</p>
        <progress value={percent} max={100} className="h-1 w-full" aria-label={t('sidebar.integrity')} />
      </div>
    )
  }
  const { report } = state
  if (!report.problems.length) {
    return (
      <p className="m-0 flex items-center gap-1.5">
        <Icon name="pass-filled" className="text-[16px] text-fg-muted" />
        {t('integrity.intact', { count: report.checked })}
      </p>
    )
  }
  return (
    <div>
      <p className="m-0 mb-2 flex items-center gap-1.5">
        <Icon name="warning" className="text-[16px]" />
        {t(report.problems.length === 1 ? 'integrity.problemsOne' : 'integrity.problems', { count: report.problems.length })}
      </p>
      <ul className="m-0 list-none p-0">
        {report.problems.map((problem, i) => (
          <li key={i} className="mb-1.5 text-[12px]">
            {problem.path ? (
              <button type="button" onClick={() => onOpenFile(problem.path!)} className="text-left hover:underline">
                {describeIssue(t, problem)}
              </button>
            ) : (
              describeIssue(t, problem)
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
