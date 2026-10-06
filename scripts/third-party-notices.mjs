#!/usr/bin/env node
// Writes THIRD-PARTY-NOTICES.md: the licences of the libraries that end up inside the application (they are bundled by Vite, so they are
// development dependencies in package.json), with their full texts, and what Electron ships. The installers carry the file, and the About
// window shows it.
//
//   node scripts/third-party-notices.mjs           writes THIRD-PARTY-NOTICES.md
//   node scripts/third-party-notices.mjs --check   exits 1 when the file is not what the libraries now in node_modules give
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const OUT = path.join(root, 'THIRD-PARTY-NOTICES.md')

// What the application imports (src/, electron/, core/); everything they need is found through their own dependencies.
const ROOTS = [
  'react', 'react-dom', 'allotment', '@vscode/codicons', 'pdfjs-dist', 'yauzl', 'yazl', 'parse5',
  '@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands', '@codemirror/autocomplete', '@codemirror/lang-json', '@codemirror/lang-html',
  '@codemirror/lang-css', '@codemirror/lang-javascript', '@codemirror/lang-xml', '@codemirror/lang-markdown', '@codemirror/lang-yaml', '@lezer/highlight', 'js-beautify',
  // The libraries that draw office documents (src/docs/): each is built into a script of its own.
  'docx-preview', '@aiden0z/pptx-renderer', '@opendocument/odr-core',
]
// Only one file of these is bundled, so what their package.json lists for their command-line tools is not inside the application.
const NO_DEPENDENCIES = new Set(['js-beautify'])
// Data files shipped with a library under licences of their own.
const EXTRA = [
  ['pdfjs-dist', 'standard_fonts', 'The fonts pdf.js uses for PDFs that do not carry theirs (Foxit and Liberation)'],
  ['pdfjs-dist', 'cmaps', 'The character maps pdf.js uses for CJK text (Adobe)'],
  ['pdfjs-dist', 'wasm', 'The decoders pdf.js runs as WebAssembly (OpenJPEG, JBIG2, QCMS)'],
  ['pdfjs-dist', 'iccs', 'The colour profile pdf.js uses'],
]

// What odr-core's WebAssembly is built from (its conanfile.py, v7.4.0), which no package.json lists.
const COMPILED_IN = [
  ['pugixml', 'MIT'], ['fmt', 'MIT'], ['md4c', 'MIT'], ['miniz', 'MIT'], ['nlohmann/json', 'MIT'], ['openjpeg', 'BSD-2-Clause'],
  ['Crypto++', 'BSL-1.0'], ['utfcpp', 'BSL-1.0'], ['uchardet', 'MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later (used under the MPL)'],
]

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const dirOf = (name) => path.join(root, 'node_modules', name)

/** Every package reachable from the roots through `dependencies`, each once, by name. */
function collect() {
  const found = new Map()
  const visit = (name) => {
    if (found.has(name) || !fs.existsSync(path.join(dirOf(name), 'package.json'))) return
    const pkg = readJson(path.join(dirOf(name), 'package.json'))
    found.set(name, pkg)
    if (!NO_DEPENDENCIES.has(name)) for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep)
  }
  ROOTS.forEach(visit)
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const licenceFiles = (dir) => fs.readdirSync(dir).filter((f) => /^(licen[sc]e|copying|notice)(\.|-|$)/i.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort()
const textOf = (dir) => licenceFiles(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n---\n\n')
const repo = (pkg) => (typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? pkg.homepage ?? '')).replace(/^git\+/, '').replace(/\.git$/, '')
const licenceOf = (pkg) => (typeof pkg.license === 'string' ? pkg.license : (pkg.licenses?.map((l) => l.type).join(' OR ') ?? 'see the licence text'))

function build() {
  const packages = collect()
  const lines = [
    '# Third-party notices',
    '',
    'Folder Browser is MIT-licensed (`LICENSE`). It contains the libraries below, under their own licences, and Electron with Chromium. This file is made by',
    '`npm run notices` from the libraries that are bundled into the application, and it is shipped with every installer.',
    '',
    '## Electron and Chromium',
    '',
    'Every installation folder holds Electron\'s `LICENSE` and `LICENSES.chromium.html`: the licence of Electron (MIT) and the licences of Chromium and of the',
    'libraries Chromium contains. They are shipped unchanged by electron-builder.',
    '',
    '## Icons',
    '',
    '- **Codicons** (`@vscode/codicons`), © Microsoft Corporation: the icons are under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and the code under MIT. The icons of the interface are Codicons.',
    '- The application icon is this project\'s own (`build/icon.svg`, MIT). The interface is *inspired by* Visual Studio Code and is not it, nor endorsed by Microsoft.',
    '',
    '## Libraries',
    '',
    '| Library | Version | Licence | Source |',
    '| --- | --- | --- | --- |',
    ...packages.map(([name, pkg]) => `| ${name} | ${pkg.version} | ${licenceOf(pkg)} | ${repo(pkg)} |`),
    '',
    '## Data files of pdf.js',
    '',
    ...EXTRA.map(([lib, folder, what]) => {
      const dir = path.join(dirOf(lib), folder)
      const files = fs.existsSync(dir) ? licenceFiles(dir) : []
      return `- **${lib}/${folder}**: ${what}. ${files.length ? `Licence files: ${files.map((f) => `\`${f}\``).join(', ')} (texts below).` : 'Licence: see the library\'s LICENSE.'}`
    }),
    '',
    '## Compiled into odr-core',
    '',
    'The WebAssembly of `@opendocument/odr-core` (MPL-2.0; the source is at https://github.com/opendocument-app/OpenDocument.core, and this application uses the published package unchanged) is built from these C++ libraries:',
    '',
    ...COMPILED_IN.map(([name, licence]) => `- **${name}**: ${licence}`),
    '',
    'Their licence texts are in the repository above (`conanfile.py` names the versions; `tools/pdf/THIRD_PARTY_LICENSES.md` the PDF tables).',
    '',
    '## Licence texts',
    '',
  ]
  // Texts that are the same for several libraries are written once.
  const byText = new Map()
  for (const [name, pkg] of packages) {
    const text = textOf(dirOf(name)) || `${licenceOf(pkg)} (the library does not ship a licence file; see ${repo(pkg) || 'its repository'})`
    byText.set(text, [...(byText.get(text) ?? []), `${name} ${pkg.version}`])
  }
  for (const [lib, folder] of EXTRA) {
    const dir = path.join(dirOf(lib), folder)
    if (!fs.existsSync(dir)) continue
    for (const f of licenceFiles(dir)) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()
      byText.set(text, [...(byText.get(text) ?? []), `${lib}/${folder}/${f}`])
    }
  }
  for (const [text, owners] of [...byText.entries()].sort((a, b) => a[1][0].localeCompare(b[1][0]))) {
    lines.push(`### ${owners.join(', ')}`, '', '```text', text, '```', '')
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`.trimEnd() + '\n'
}

const text = build()
if (process.argv.includes('--check')) {
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) {
    console.error('THIRD-PARTY-NOTICES.md is not what the libraries now give: run npm run notices and commit it')
    process.exit(1)
  }
  console.log('THIRD-PARTY-NOTICES.md is up to date')
} else {
  fs.writeFileSync(OUT, text)
  console.log(`wrote THIRD-PARTY-NOTICES.md (${text.split('\n').length} lines)`)
}
