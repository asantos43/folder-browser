import type { SnapshotInfo } from '@core/snapshots.ts'

/** A snapshot as the interface gets it from the main process, for the component tests. */
export function snapshotInfo(id: string, title = id, extra: Partial<SnapshotInfo> = {}): SnapshotInfo {
  const files = [
    { path: 'mimetype', size: 24 },
    { path: 'manifest.json', size: 900, mediaType: 'application/json' },
    { path: 'index.html', size: 400, mediaType: 'text/html' },
    { path: 'assets/styles/site.css', size: 90, mediaType: 'text/css' },
    { path: 'assets/images/logo.png', size: 70, mediaType: 'image/png' },
    { path: 'assets/files/report.pdf', size: 56, mediaType: 'application/pdf' },
    { path: 'assets/files/bundle.zip', size: 22, mediaType: 'application/zip' },
    { path: '_wsnp/offline.js', size: 200, mediaType: 'text/javascript' },
  ]
  return {
    id,
    path: `/home/me/${id}.wsnp`,
    files,
    signature: { state: 'unsigned' },
    manifest: {
      format: 'wsnp',
      format_version: '1.0',
      generator: { name: 'PageKeep', version: '1.5.0' },
      created: '2026-09-29T12:00:00.000Z',
      title,
      description: '',
      source: { url: `https://${id}.example/`, canonical: '', language: 'en' },
      pages: [{ entry: 'index.html' }],
      viewport: { width: 1280, height: 800, device_pixel_ratio: 1 },
      files: [],
      failed: [{ url: 'https://cdn.example/old.png', reason: 'HTTP 404' }],
    },
    ...extra,
  }
}
