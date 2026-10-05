import { effectiveType, viewKind } from '@core/filekind.ts'

/** The Codicon of a file, by what it is. (VS Code's own file icons are Seti's: a later refinement.) */
export function fileIcon(mediaType: string | undefined, name: string): string {
  const type = effectiveType(mediaType, name)
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'code'
  if (type === 'application/json' || /\+json$/.test(type)) return 'json'
  if (type === 'text/css') return 'symbol-color'
  if (/javascript|ecmascript/.test(type)) return 'symbol-method'
  if (type === 'image/svg+xml') return 'symbol-misc'
  if (type === 'application/pdf') return 'file-pdf'
  if (/zip|compressed|tar|gzip|rar|7z/.test(type)) return 'file-zip'
  const kind = viewKind(type, name, 0)
  if (kind === 'image') return 'file-media'
  if (kind === 'font') return 'text-size'
  if (kind === 'text') return 'file-code'
  return /^(audio|video)\//.test(type) ? 'file-media' : 'file-binary'
}
