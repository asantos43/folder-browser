import { RESULT_LIMIT, type QueryResult } from '@core/sqlTable.ts'
import { useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import type { SqlSession } from '@/state/sqlSession.ts'

type Note = { kind: 'error' | 'info'; text: string }

/**
 * The query box of a table: one SELECT on the table `t` (the columns are named by the header), run by SQLite in a worker. The rows of the result replace the rows shown until
 * **Show All Rows**; **Export Result** writes them as a delimited file. Nothing in the file is written by a query.
 */
export function QueryBar({ session, names, sql, onSql, result, onResult, onExport }: { session: SqlSession; names: string[]; sql: string; onSql: (sql: string) => void; result: QueryResult | null; onResult: (result: QueryResult | null) => void; onExport: (result: QueryResult) => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    const outcome = await session.query(sql)
    setBusy(false)
    if (outcome.ok) {
      onResult(outcome.result)
      setNote({ kind: 'info', text: outcome.result.more ? t('query.more', { limit: RESULT_LIMIT.toLocaleString() }) : t('query.rows', { count: outcome.result.rows.length }) })
    } else {
      setNote({ kind: 'error', text: t(`query.error.${outcome.error}` as MessageKey, { message: outcome.message ?? '' }) })
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-group-border bg-editor px-2 py-1.5 text-[13px] text-fg">
      <textarea
        aria-label={t('query.label')}
        placeholder={t('query.placeholder')}
        value={sql}
        rows={3}
        spellCheck={false}
        onChange={(e) => onSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void run()
          }
        }}
        className="w-full resize-y rounded-sm border border-group-border bg-editor p-1 font-mono text-[13px] text-editor-fg outline-none focus-visible:outline-1 focus-visible:outline-focus"
      />
      <div className="flex items-center gap-2">
        <button type="button" title={t('query.runTitle')} disabled={busy} onClick={() => void run()} className="h-[24px] rounded bg-button px-3 text-button-fg hover:bg-button-hover disabled:opacity-50">
          {busy ? t('query.running') : t('query.run')}
        </button>
        <button type="button" disabled={!result} onClick={() => onResult(null)} className="h-[24px] rounded px-2 hover:bg-toolbar-hover disabled:opacity-40 disabled:hover:bg-transparent">
          {t('query.showAll')}
        </button>
        <button type="button" disabled={!result} onClick={() => result && onExport(result)} className="h-[24px] rounded px-2 hover:bg-toolbar-hover disabled:opacity-40 disabled:hover:bg-transparent">
          {t('query.export')}
        </button>
        {note ? (
          <span role={note.kind === 'error' ? 'alert' : 'status'} className={`min-w-0 truncate ${note.kind === 'error' ? 'text-error' : 'text-fg-muted'}`} title={note.text}>
            {note.text}
          </span>
        ) : null}
      </div>
      <p className="m-0 truncate text-[12px] text-fg-muted" title={names.join(', ')}>
        {t('query.hint', { columns: names.map((n) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n}"`)).join(', ') })}
      </p>
    </div>
  )
}
