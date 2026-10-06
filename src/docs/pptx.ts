import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer/browser'
import { boot } from './boot.ts'

// A presentation, a slide under another, each drawn at the size it has (the library limits what the ZIP may unpack to).
boot(async (bytes, root) => {
  const viewer = await PptxViewer.open(bytes, root, { zipLimits: RECOMMENDED_ZIP_LIMITS, fitMode: 'contain', listOptions: { windowed: true } })
  return { views: viewer.slideCount }
})
