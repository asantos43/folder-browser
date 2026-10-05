import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'

let counter = 0
const SIZES = [12, 18, 24, 36, 48, 72]

/** A font of the snapshot, loaded from its bytes and shown at several sizes. */
export function FontView({ bytes }: { bytes: Uint8Array }) {
  const { t } = useI18n()
  const [family, setFamily] = useState<string | 'broken' | null>(null)
  useEffect(() => {
    const name = `wsnp-sample-${counter++}`
    const face = new FontFace(name, bytes.slice().buffer as ArrayBuffer)
    let alive = true
    face.load().then(
      () => {
        document.fonts.add(face)
        if (alive) setFamily(name)
      },
      () => alive && setFamily('broken'),
    )
    return () => {
      alive = false
      document.fonts.delete(face)
    }
  }, [bytes])
  if (family === 'broken') return <p className="m-0 p-6 text-fg-muted">{t('file.fontBroken')}</p>
  return (
    <div className="h-full min-h-0 flex-1 overflow-auto bg-editor p-6 text-editor-fg" style={{ fontFamily: family ? `"${family}"` : undefined }}>
      <p className="m-0 mb-4 text-[28px]">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</p>
      {SIZES.map((px) => (
        <p key={px} className="m-0 mb-2 truncate" style={{ fontSize: px }}>
          {t('file.fontSample')}
        </p>
      ))}
    </div>
  )
}
