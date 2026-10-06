import { detectDelimiter, MAX_COLUMNS, MAX_ROWS, parseDelimited } from '@core/csv.ts'
import { useMemo, type CSSProperties } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { csvView } from '@/state/setting.ts'
import { FileActions, SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

/** The two ways to see a CSV or TSV file, side by side in the toolbar of either: as a table, or as the text it is written in. The choice is kept for every such file. */
export function CsvToggle() {
  const { t } = useI18n()
  const view = csvView.use()
  return (
    <>
      <ToolbarButton icon="table" text={t('csv.table')} label={t('csv.tableTitle')} pressed={view === 'table'} onClick={() => csvView.set('table')} />
      <ToolbarButton icon="code" text={t('csv.text')} label={t('csv.textTitle')} pressed={view === 'text'} onClick={() => csvView.set('text')} />
      <Separator />
    </>
  )
}

/** A CSV or TSV file as a table: the first row is the header and stays in view, the rows are numbered, and the cells are text (nothing in them is read as markup or followed). */
export function CsvView({ text, name, tab, onSave, onOpenWith, onHex, zoom = 1 }: { text: string; name: string; tab: boolean; onSave: () => void; onOpenWith?: () => void; onHex?: () => void; zoom?: number }) {
  const { t } = useI18n()
  const table = useMemo(() => parseDelimited(text, detectDelimiter(text, tab)), [text, tab])
  const [head, ...body] = table.rows
  const columns = Math.min(table.columns, MAX_COLUMNS)
  const cell = 'border-r border-b border-group-border px-2 py-0.5 whitespace-pre'
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        <CsvToggle />
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
        <FileActions onOpenWith={onOpenWith} onHex={onHex} />
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] text-fg-muted">
          {table.truncated ? <span>{t('csv.truncated', { rows: String(MAX_ROWS), columns: String(MAX_COLUMNS) })}</span> : null}
          <span>{t('csv.size', { rows: String(table.rows.length), columns: String(columns) })}</span>
        </span>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto bg-editor text-editor-fg select-text" style={{ '--wsnp-zoom': zoom, fontSize: `${13 * zoom}px` } as CSSProperties}>
        <table aria-label={t('csv.label', { name })} className="border-separate border-spacing-0 font-mono">
          {head ? (
            <thead>
              <tr>
                <th scope="col" className={`${cell} sticky top-0 left-0 z-20 bg-widget text-fg-muted`} />
                {Array.from({ length: columns }, (_, i) => (
                  <th key={i} scope="col" className={`${cell} sticky top-0 z-10 bg-widget text-left font-semibold`}>
                    {head[i] ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="hover:bg-list-hover">
                <th scope="row" className={`${cell} sticky left-0 bg-widget text-right font-normal text-fg-muted`}>
                  {r + 2}
                </th>
                {Array.from({ length: columns }, (_, i) => (
                  <td key={i} className={cell}>
                    {row[i] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
