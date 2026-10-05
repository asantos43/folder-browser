/** `manifest.json` of a .wsnp (docs/FORMAT.md section 6). Fields a reader does not know are ignored, so they are not listed. */
export interface ManifestFile {
  path: string
  original_url?: string
  media_type: string
  bytes: number
  sha256: string
  source?: string
}

export interface ManifestSource {
  url: string
  canonical?: string
  language?: string
}

export interface ManifestPage {
  entry: string
  title?: string
  description?: string
  source?: ManifestSource
}

export interface Manifest {
  format: 'wsnp'
  format_version: string
  generator: { name: string; version: string }
  created: string
  title: string
  description: string
  source: ManifestSource
  pages: ManifestPage[]
  preview?: string
  viewport: { width: number; height: number; device_pixel_ratio?: number }
  capture?: { load_whole_page?: boolean }
  converted_from?: { format: string; tool: string }
  files: ManifestFile[]
  failed: { url: string; reason: string }[]
}

export const WSNP_TYPE = 'application/vnd.wsnp+zip'
export const WSNPX_TYPE = 'application/vnd.wsnp.x+zip'
/** The major version of the format this reader knows (FORMAT.md section 11). */
export const KNOWN_MAJOR = 1
