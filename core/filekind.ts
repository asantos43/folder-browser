/** How a file of a snapshot is shown in a tab (docs/VIEWER-GUIDELINES.md, "Files inside a snapshot"). */
export type ViewKind = 'text' | 'image' | 'pdf' | 'font' | 'zip' | 'media' | 'other'

/** Source in the viewer's colours, for these languages; anything else is plain text. */
export type Language =
  | 'json' | 'html' | 'css' | 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'xml' | 'markdown' | 'yaml' | 'plain'
  | 'python' | 'c' | 'cpp' | 'java' | 'kotlin' | 'scala' | 'csharp' | 'dart' | 'rust' | 'go' | 'swift' | 'php' | 'ruby' | 'perl' | 'lua' | 'r' | 'groovy'
  | 'haskell' | 'julia' | 'clojure' | 'erlang' | 'shell' | 'powershell' | 'sql' | 'toml' | 'properties' | 'dockerfile' | 'cmake' | 'diff' | 'protobuf'
  | 'scss' | 'sass' | 'less' | 'pascal'

/** Every language the viewer can colour, for the list a user picks from (the order is the list's own: Plain Text first, then by name in the interface). */
export const LANGUAGES: readonly Language[] = [
  'plain', 'json', 'html', 'css', 'javascript', 'typescript', 'jsx', 'tsx', 'xml', 'markdown', 'yaml',
  'python', 'c', 'cpp', 'java', 'kotlin', 'scala', 'csharp', 'dart', 'rust', 'go', 'swift', 'php', 'ruby', 'perl', 'lua', 'r', 'groovy',
  'haskell', 'julia', 'clojure', 'erlang', 'pascal', 'shell', 'powershell', 'sql', 'toml', 'properties', 'dockerfile', 'cmake', 'diff', 'protobuf',
  'scss', 'sass', 'less',
]

/**
 * The languages of source files beyond the web's own: the media type the viewer gives them, and the extensions (or whole lowercase names, when a file has
 * no extension) that mean them. A file declared with another type for the same language is told by `LANGUAGE_ALIASES`.
 */
const SOURCE_LANGUAGES: [Language, string, string[]][] = [
  ['python', 'text/x-python', ['py', 'pyi', 'pyw']],
  ['c', 'text/x-csrc', ['c', 'h']],
  ['cpp', 'text/x-c++src', ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ino']],
  ['java', 'text/x-java', ['java']],
  ['kotlin', 'text/x-kotlin', ['kt', 'kts']],
  ['scala', 'text/x-scala', ['scala', 'sc']],
  ['csharp', 'text/x-csharp', ['cs']],
  ['dart', 'text/x-dart', ['dart']],
  ['rust', 'text/x-rust', ['rs']],
  ['go', 'text/x-go', ['go']],
  ['swift', 'text/x-swift', ['swift']],
  ['php', 'application/x-httpd-php', ['php', 'phtml']],
  ['ruby', 'text/x-ruby', ['rb', 'rake', 'gemspec', 'gemfile', 'rakefile', 'vagrantfile']],
  ['perl', 'text/x-perl', ['pl', 'pm']],
  ['lua', 'text/x-lua', ['lua']],
  ['r', 'text/x-rsrc', ['r']],
  ['groovy', 'text/x-groovy', ['groovy', 'gradle']],
  ['haskell', 'text/x-haskell', ['hs']],
  ['julia', 'text/x-julia', ['jl']],
  ['clojure', 'text/x-clojure', ['clj', 'cljs', 'cljc', 'edn']],
  ['erlang', 'text/x-erlang', ['erl', 'hrl']],
  ['shell', 'text/x-sh', ['sh', 'bash', 'zsh', 'ksh', 'fish', 'bashrc', 'zshrc', 'profile', 'bash_profile', 'zprofile']],
  ['powershell', 'text/x-powershell', ['ps1', 'psm1', 'psd1']],
  ['sql', 'text/x-sql', ['sql']],
  ['toml', 'application/toml', ['toml']],
  ['properties', 'text/x-properties', ['properties', 'ini', 'cfg', 'conf', 'config', 'env', 'editorconfig', 'gitconfig', 'npmrc']],
  ['dockerfile', 'text/x-dockerfile', ['dockerfile']],
  ['cmake', 'text/x-cmake', ['cmake']],
  ['diff', 'text/x-diff', ['diff', 'patch']],
  ['protobuf', 'text/x-protobuf', ['proto']],
  ['scss', 'text/x-scss', ['scss']],
  ['sass', 'text/x-sass', ['sass']],
  ['less', 'text/x-less', ['less']],
  ['pascal', 'text/x-pascal', ['pas', 'pp', 'dpr', 'lpr', 'inc']],
]
/** Other media types the same languages go by. */
const LANGUAGE_ALIASES: Record<string, Language> = {
  'application/x-sh': 'shell', 'application/x-shellscript': 'shell', 'text/x-shellscript': 'shell', 'application/x-bash': 'shell', 'text/x-script.sh': 'shell',
  'application/sql': 'sql', 'text/x-python-script': 'python', 'application/x-python': 'python', 'text/x-script.python': 'python',
  'text/x-php': 'php', 'application/x-php': 'php', 'application/php': 'php', 'application/x-perl': 'perl', 'application/x-ruby': 'ruby',
  'text/x-c': 'c', 'text/x-chdr': 'c', 'text/x-c++': 'cpp', 'text/x-c++hdr': 'cpp', 'application/x-toml': 'toml', 'text/toml': 'toml',
}
const LANGUAGE_OF_TYPE = new Map<string, Language>([...SOURCE_LANGUAGES.map(([language, type]) => [type, language] as const), ...Object.entries(LANGUAGE_ALIASES)])

/** A text file bigger than this is not opened in a tab: it is offered with Save As, like a PDF. */
export const TEXT_LIMIT = 5 * 2 ** 20
/** A picture or a font bigger than this is not read into the interface either. */
export const BINARY_LIMIT = 64 * 2 ** 20
/** A ZIP inside a snapshot is opened in memory to list and extract it: a bigger one is only offered with Save As. */
export const ZIP_LIMIT = 256 * 2 ** 20

const BY_EXTENSION: Record<string, string> = {
  html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/jsx', ts: 'text/typescript', tsx: 'text/tsx',
  json: 'application/json', map: 'application/json', webmanifest: 'application/manifest+json', txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', yml: 'text/yaml', yaml: 'text/yaml',
  csv: 'text/csv', xml: 'application/xml', rss: 'application/xml', atom: 'application/xml', svg: 'image/svg+xml', vtt: 'text/vtt', srt: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  zip: 'application/zip', pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', wav: 'audio/wav', flac: 'audio/flac', weba: 'audio/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
}

/** Source and configuration files with no colours of their own: plain text, read as such. */
const PLAIN_EXTENSIONS = [
  'bat', 'cmd', 'm', 'graphql', 'tex', 'bib', 'rst', 'adoc', 'org', 'tsv', 'lock', 'gitattributes', 'dockerignore', 'gitignore', 'prettierrc', 'eslintrc', 'nvmrc', 'vue', 'svelte', 'tf', 'hcl', 'ipynb', 'ics', 'vcf', 'gpx', 'pm6',
]
/** Files known by their whole name (no extension). */
const PLAIN_NAMES = ['readme', 'license', 'licence', 'copying', 'notice', 'authors', 'contributors', 'changelog', 'changes', 'contributing', 'makefile', 'procfile', 'todo', 'version', 'codeowners', 'install', 'news', 'history']
for (const [, type, keys] of SOURCE_LANGUAGES) for (const key of keys) BY_EXTENSION[key] ??= type
for (const ext of PLAIN_EXTENSIONS) BY_EXTENSION[ext] ??= 'text/plain'
for (const name of PLAIN_NAMES) BY_EXTENSION[name] ??= 'text/plain'

/** The key of a file name in the table above: its extension, or the whole name when it has none (`LICENSE`, `Makefile`). */
function extensionKey(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase()
  const ext = /\.([a-z0-9]+)$/.exec(base)?.[1]
  return ext ?? base
}

/**
 * The declared media type when it says something, else the one the extension suggests. A server that calls everything `text/plain` or
 * `application/octet-stream` says nothing: the extension then decides (a `.md` served as plain text is still Markdown).
 */
export function effectiveType(mediaType: string | undefined, name: string): string {
  const declared = (mediaType ?? '').split(';')[0].trim().toLowerCase()
  const key = extensionKey(name)
  const byName = Object.hasOwn(BY_EXTENSION, key) ? BY_EXTENSION[key] : undefined
  const weak = declared === '' || declared === 'application/octet-stream' || declared === 'text/plain'
  if (weak && byName) return byName
  return declared || 'application/octet-stream'
}

const IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/
const TEXT = /^(text\/.+|application\/(json|javascript|ecmascript|xml|xhtml\+xml|x-javascript|ld\+json|manifest\+json|sql|toml|x-toml|x-sh|x-shellscript|x-bash|x-httpd-php|x-php|php|x-perl|x-ruby|x-python|yaml|x-yaml)|.+\+(json|xml)|image\/svg\+xml)$/
const ZIP = /^application\/(zip|x-zip|x-zip-compressed)$/
const FONT = /^(font\/.+|application\/(font-woff2?|x-font-.+|vnd\.ms-fontobject))$/

/**
 * Whether a file is a video or a sound, by its type or its name: it is played in a tab, whether it is a file of a folder, an entry of a ZIP or a file of a snapshot.
 * (`viewKind` never answers `media`: the callers ask `mediaKind` first.)
 */
export function mediaKind(mediaType: string | undefined, name: string): 'video' | 'audio' | null {
  const type = effectiveType(mediaType, name)
  return /^video\/[a-z0-9.+-]+$/.test(type) ? 'video' : /^audio\/[a-z0-9.+-]+$/.test(type) ? 'audio' : null
}

/** What tab a file gets. office documents, audio, video and unknown types are `other`: they are saved, not shown. */
export function viewKind(mediaType: string | undefined, name: string, size: number): ViewKind {
  const type = effectiveType(mediaType, name)
  if (TEXT.test(type)) return size <= TEXT_LIMIT ? 'text' : 'other'
  if (IMAGE.test(type)) return size <= BINARY_LIMIT ? 'image' : 'other'
  if (type === 'application/pdf') return size <= BINARY_LIMIT ? 'pdf' : 'other'
  if (FONT.test(type)) return size <= BINARY_LIMIT ? 'font' : 'other'
  if (ZIP.test(type)) return size <= ZIP_LIMIT ? 'zip' : 'other'
  return 'other'
}

/**
 * A file of no known kind (`application/octet-stream`, as a ZIP's entries and many saved files are) that is small enough may still be text: the viewer reads
 * it and looks (`looksLikeText`) before offering only Save As.
 */
export function canProbe(mediaType: string | undefined, name: string, size: number): boolean {
  return viewKind(mediaType, name, size) === 'other' && effectiveType(mediaType, name) === 'application/octet-stream' && size <= TEXT_LIMIT
}

/** Whether bytes are text: no NUL byte and valid UTF-8 in the first 8 KiB (a character cut by the end of the sample does not count against it). */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192)
  if (sample.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: bytes.length > sample.length })
    return true
  } catch {
    return false
  }
}

/** An SVG picture: it is text (source), and a picture too, and the viewer lets the user switch between the two. */
export const isSvg = (mediaType: string | undefined, name: string): boolean => effectiveType(mediaType, name) === 'image/svg+xml'

/** Languages whose text a formatter can lay out again (the others are shown as they are). */
export const FORMATTABLE: readonly Language[] = ['json', 'html', 'css', 'javascript', 'xml']

export function languageOf(mediaType: string | undefined, name: string): Language {
  const type = effectiveType(mediaType, name)
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html'
  if (type === 'text/css') return 'css'
  if (type === 'text/typescript' || type === 'application/typescript') return 'typescript'
  if (type === 'text/jsx') return 'jsx'
  if (type === 'text/tsx') return 'tsx'
  if (/javascript|ecmascript/.test(type)) return 'javascript'
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown'
  if (/yaml/.test(type)) return 'yaml'
  if (/json/.test(type)) return 'json'
  if (/xml/.test(type)) return 'xml'
  return LANGUAGE_OF_TYPE.get(type) ?? 'plain'
}
