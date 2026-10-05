#!/usr/bin/env node
// Keeps the copy of the WSNP format description in this repository the same as the source of truth, the wsnp-viewer repository.
//
//   docs/FORMAT.md and docs/MANIFEST-SIGNING.md: wsnp-viewer's are the source of truth, these are exact copies, never edited here.
//   docs/FORMAT.sha256: their SHA-256, copied with them.
//
//   node format-sync.mjs                   checks that the docs match their recorded hashes, and, when wsnp-viewer is found beside this
//                                          repository, that its copies are identical. Exit 1 with a list of what differs.
//   node format-sync.mjs --sibling=PATH    where wsnp-viewer is (or WSNP_SIBLING; by default the folder beside this one).
//   node format-sync.mjs --require-sibling fail instead of skipping when wsnp-viewer is not found.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const DOCS = ['docs/FORMAT.md', 'docs/MANIFEST-SIGNING.md']
const RECORD = 'docs/FORMAT.sha256'
const read = (base, file) => (fs.existsSync(path.join(base, file)) ? fs.readFileSync(path.join(base, file)) : undefined)
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const problems = []
const fail = (text) => problems.push(text)

/** The first line where two texts differ, for the message. */
function firstDifference(a, b) {
  const x = a.toString('utf8').split('\n')
  const y = b.toString('utf8').split('\n')
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `line ${i + 1}: «${(x[i] ?? '(missing)').slice(0, 70)}» against «${(y[i] ?? '(missing)').slice(0, 70)}»`
  return 'no line differs'
}

const recorded = () => `${DOCS.map((f) => `${sha(read(root, f) ?? Buffer.alloc(0))}  ${f}`).join('\n')}\n`

// 1. The docs of this repository match the hashes recorded for them.
const record = read(root, RECORD)
if (!record) fail(`${RECORD} is missing: copy it from wsnp-viewer together with the docs`)
else if (record.toString('utf8') !== recorded()) fail(`${DOCS.join(' or ')} changed without ${RECORD}: copy wsnp-viewer's docs and record here, do not edit them in this repository`)

// 2. wsnp-viewer has the same.
const sibling = path.resolve(option('sibling') ?? process.env.WSNP_SIBLING ?? path.resolve(root, '../wsnp-viewer'))
let compared = false
if (fs.existsSync(sibling) && sibling !== root) {
  compared = true
  for (const file of [...DOCS, RECORD]) {
    const a = read(sibling, file)
    const b = read(root, file)
    if (!a || !b) fail(`${file} is missing in ${!a ? 'wsnp-viewer' : 'this repository'}`)
    else if (!a.equals(b)) fail(`${file} differs (wsnp-viewer's is the source): ${firstDifference(a, b)}`)
  }
} else if (args.includes('--require-sibling')) fail(`wsnp-viewer was not found at ${sibling}`)

if (problems.length) {
  console.error(`The description of the WSNP format is not the same as in wsnp-viewer:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(compared ? `format docs: identical to wsnp-viewer (${sibling})` : `format docs: match ${RECORD}; wsnp-viewer was not found, so it was not compared`)
