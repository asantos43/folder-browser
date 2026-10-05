import type { SnapshotInfo } from '@core/snapshots.ts'
import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { formatBytes, formatDate } from '@/lib/format.ts'
import type { IntegrityState } from '@/state/workspace.ts'
import { IntegrityPanel } from '@/workbench/IntegrityPanel.tsx'
import { describeSignature, type Signers } from '@/workbench/signature.ts'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="m-0 mb-2 border-b border-group-border pb-1 text-[13px] font-bold uppercase text-fg-muted">{title}</h2>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[13px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="m-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Everything the manifest says about a snapshot, in words, and what the viewer has checked about it: the structure, the contents
 * (SHA-256 of every file) and the signature. The raw manifest is one click away.
 */
export function MetadataView({ snapshot, integrity, signers, onOpenExternal, onOpenManifest, onCopy, onOpenFile, onTrust, onForget }: { snapshot: SnapshotInfo; integrity: IntegrityState | undefined; signers: Signers; onOpenExternal: (url: string) => void; onOpenManifest: () => void; onCopy: (text: string) => void; onOpenFile: (path: string) => void; onTrust: (fingerprint: string, name?: string) => void; onForget: (fingerprint: string) => void }) {
  const { t, language } = useI18n()
  const [name, setName] = useState('')
  const sig = describeSignature(t, snapshot.signature, signers)
  const signed = snapshot.signature.state === 'valid' ? snapshot.signature : undefined
  const m = snapshot.manifest
  const bytes = snapshot.files.reduce((sum, f) => sum + f.size, 0)
  const page = m.pages[0]
  const link = (url: string) => (
    <button type="button" onClick={() => onOpenExternal(url)} className="break-all text-left text-link hover:underline">
      {url}
    </button>
  )
  const yesNo = (value: boolean | undefined) => (value === undefined ? t('info.notRecorded') : t(value ? 'metadata.yes' : 'metadata.no'))
  return (
    <div aria-label={t('metadata.breadcrumb')} className="h-full min-h-0 flex-1 overflow-auto bg-editor p-6 text-editor-fg select-text">
      <div className="mx-auto max-w-[820px]">
        <div className="mb-4 flex items-center gap-2">
          <button type="button" onClick={onOpenManifest} className="flex h-[26px] items-center gap-1.5 rounded-sm bg-button px-3 text-[13px] text-button-fg hover:bg-button-hover">
            <Icon name="json" />
            {t('metadata.openManifest')}
          </button>
          <button type="button" onClick={() => onCopy(JSON.stringify(m, null, 2))} className="flex h-[26px] items-center gap-1.5 rounded-sm px-3 text-[13px] hover:bg-toolbar-hover">
            <Icon name="copy" />
            {t('metadata.copy')}
          </button>
        </div>

        <Section title={t('metadata.validation')}>
          <Rows
            rows={[
              [
                t('metadata.structure'),
                <span key="s" className="flex items-start gap-1.5">
                  <Icon name="pass-filled" className="mt-px text-[16px]" />
                  {t('metadata.structureOk')}
                </span>,
              ],
              [t('metadata.contentsCheck'), <IntegrityPanel key="c" state={integrity} onOpenFile={onOpenFile} />],
              [
                t('metadata.signature'),
                <div key="g">
                  <span className={`flex items-start gap-1.5 ${sig.level === 'invalid' ? 'text-error' : ''}`}>
                    <Icon name={sig.icon} className="mt-px text-[16px]" />
                    {sig.text}
                  </span>
                  {signed ? (
                    <dl className="m-0 mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px] text-fg-muted">
                      <dt>{t('signature.algorithm')}</dt>
                      <dd className="m-0">{signed.algorithm}</dd>
                      <dt>{t('signature.fingerprint')}</dt>
                      <dd className="m-0 font-mono">{signed.fingerprintShort}</dd>
                    </dl>
                  ) : null}
                  {signed && sig.level === 'new' ? (
                    <form
                      className="mt-2 flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        onTrust(signed.fingerprint, name)
                        setName('')
                      }}
                    >
                      <input
                        aria-label={t('signature.trustName')}
                        placeholder={t('signature.trustName')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={80}
                        className="h-[26px] w-56 rounded-sm border border-group-border bg-editor px-2 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus"
                      />
                      <button type="submit" className="flex h-[26px] items-center gap-1.5 rounded-sm bg-button px-3 text-[13px] text-button-fg hover:bg-button-hover">
                        {t('signature.trust')}
                      </button>
                    </form>
                  ) : null}
                  {signed && sig.level === 'trusted' ? (
                    <button type="button" onClick={() => onForget(signed.fingerprint)} className="mt-2 text-[12px] text-link hover:underline">
                      {t('signature.forget')}
                    </button>
                  ) : null}
                </div>,
              ],
            ]}
          />
        </Section>

        <Section title={t('metadata.identification')}>
          <Rows
            rows={[
              [t('metadata.format'), m.format],
              [t('metadata.version'), m.format_version],
              [t('info.generator'), `${m.generator.name} ${m.generator.version}`],
              [t('info.captured'), formatDate(m.created, language)],
              ...(m.converted_from ? ([[t('info.convertedFrom'), `${m.converted_from.format} (${m.converted_from.tool})`]] as [string, ReactNode][]) : []),
            ]}
          />
        </Section>

        <Section title={t('metadata.page')}>
          <Rows
            rows={[
              [t('info.title'), m.title],
              [t('metadata.description'), m.description || t('metadata.none')],
              [t('info.source'), link(m.source.url)],
              [t('info.canonical'), m.source.canonical ? link(m.source.canonical) : t('metadata.none')],
              [t('info.language'), m.source.language || t('metadata.none')],
              [t('metadata.entry'), page.entry],
              [t('metadata.preview'), m.preview ?? t('metadata.none')],
            ]}
          />
        </Section>

        <Section title={t('metadata.capture')}>
          <Rows
            rows={[
              [t('info.viewport'), m.converted_from ? t('info.notRecorded') : `${m.viewport.width} × ${m.viewport.height}`],
              [t('metadata.pixelRatio'), m.converted_from ? t('info.notRecorded') : String(m.viewport.device_pixel_ratio ?? 1)],
              [t('metadata.wholePage'), m.converted_from ? t('info.notRecorded') : yesNo(m.capture?.load_whole_page)],
            ]}
          />
        </Section>

        <Section title={t('metadata.contents')}>
          <Rows
            rows={[
              [t('metadata.files'), String(m.files.length)],
              [t('metadata.totalSize'), formatBytes(bytes)],
              [t('metadata.failedCount'), String(m.failed.length)],
            ]}
          />
          {m.failed.length ? (
            <ul className="m-0 mt-2 list-none p-0 text-[12px]">
              {m.failed.map((f, i) => (
                <li key={i} className="break-all">
                  {f.url} <span className="text-fg-muted">— {f.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      </div>
    </div>
  )
}
