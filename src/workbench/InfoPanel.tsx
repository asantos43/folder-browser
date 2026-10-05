import type { SnapshotInfo } from '@core/snapshots.ts'
import { useI18n } from '@/i18n/context.tsx'
import { formatDate } from '@/lib/format.ts'
import { describeSignature, type Signers } from './signature.ts'

/** What the manifest says about the snapshot: where it came from, when, how, and what could not be saved. */
export function InfoPanel({ snapshot, signers, onOpenExternal, onShowAll }: { snapshot: SnapshotInfo; signers: Signers; onOpenExternal: (url: string) => void; onShowAll: () => void }) {
  const { t, language } = useI18n()
  const m = snapshot.manifest
  const rows: [string, React.ReactNode][] = [
    [t('info.title'), m.title],
    [
      t('info.source'),
      <button key="s" type="button" onClick={() => onOpenExternal(m.source.url)} className="break-all text-left text-link hover:underline">
        {m.source.url}
      </button>,
    ],
    ...(m.source.canonical && m.source.canonical !== m.source.url ? ([[t('info.canonical'), <span key="c" className="break-all">{m.source.canonical}</span>]] as [string, React.ReactNode][]) : []),
    [t('info.captured'), formatDate(m.created, language)],
    [t('info.generator'), `${m.generator.name} ${m.generator.version}`],
    [t('info.viewport'), m.converted_from ? t('info.notRecorded') : `${m.viewport.width} × ${m.viewport.height}${m.viewport.device_pixel_ratio && m.viewport.device_pixel_ratio !== 1 ? ` @${m.viewport.device_pixel_ratio}x` : ''}`],
    ...(m.source.language ? ([[t('info.language'), m.source.language]] as [string, React.ReactNode][]) : []),
    ...(m.converted_from ? ([[t('info.convertedFrom'), `${m.converted_from.format} (${m.converted_from.tool})`]] as [string, React.ReactNode][]) : []),
    [t('metadata.signature'), describeSignature(t, snapshot.signature, signers).short],
    [t('info.file'), <span key="f" className="break-all">{snapshot.path}</span>],
  ]
  return (
    <dl className="m-0 grid grid-cols-1 gap-y-2 select-text">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11px] uppercase text-fg-muted">{label}</dt>
          <dd className="m-0 text-[13px]">{value}</dd>
        </div>
      ))}
      {m.failed.length ? (
        <div>
          <dt className="text-[11px] uppercase text-fg-muted">
            {t('info.failed')} ({m.failed.length})
          </dt>
          <dd className="m-0">
            <ul className="m-0 list-none p-0 text-[12px]">
              {m.failed.map((f, i) => (
                <li key={i} className="break-all">
                  {f.url} <span className="text-fg-muted">— {f.reason}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
      <div>
        <button type="button" onClick={onShowAll} className="text-left text-link hover:underline">
          {t('info.showAll')}
        </button>
      </div>
    </dl>
  )
}
