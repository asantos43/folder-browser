import { useI18n } from '@/i18n/context.tsx'
import { csvView } from '@/state/setting.ts'
import { Separator, ToolbarButton } from './Toolbar.tsx'

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
