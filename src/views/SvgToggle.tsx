import { useI18n } from '@/i18n/context.tsx'
import { svgView } from '@/state/setting.ts'
import { Separator, ToolbarButton } from './Toolbar.tsx'

/** The two ways to see an SVG, side by side in the toolbar of either: as the picture it draws, or as the source it is written in. The choice is kept for every SVG. */
export function SvgToggle() {
  const { t } = useI18n()
  const view = svgView.use()
  return (
    <>
      <ToolbarButton icon="file-media" text={t('svg.image')} label={t('svg.imageTitle')} pressed={view === 'image'} onClick={() => svgView.set('image')} />
      <ToolbarButton icon="code" text={t('svg.code')} label={t('svg.codeTitle')} pressed={view === 'code'} onClick={() => svgView.set('code')} />
      <Separator />
    </>
  )
}
