import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { formatBytes } from '@/lib/format.ts'
import { fileIcon } from '@/lib/icons.ts'

/** A file that cannot be shown here (a PDF, a ZIP, a document, a file too large): it can be saved to disk. */
export function OtherView({ name, mediaType, size, reason, onSave }: { name: string; mediaType: string | undefined; size: number; reason?: 'tooLarge' | 'readError'; onSave: () => void }) {
  const { t } = useI18n()
  const notice = reason === 'tooLarge' ? t('file.tooLarge') : reason === 'readError' ? t('file.readError') : t('file.other')
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-editor text-editor-fg select-text">
      <Icon name={fileIcon(mediaType, name)} className="text-[64px] text-fg-muted" />
      <h2 className="m-0 text-[16px] font-normal break-all">{name}</h2>
      <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        <dt>{t('file.type')}</dt>
        <dd className="m-0">{mediaType || '—'}</dd>
        <dt>{t('file.size')}</dt>
        <dd className="m-0">{formatBytes(size)}</dd>
      </dl>
      <p className="m-0 text-fg-muted">{notice}</p>
      <button type="button" onClick={onSave} className="flex h-[26px] items-center gap-1.5 rounded-sm bg-button px-4 text-[13px] text-button-fg hover:bg-button-hover">
        <Icon name="save-as" />
        {t('file.saveAs')}
      </button>
    </div>
  )
}
