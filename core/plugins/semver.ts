/** Small SemVer 2 parser; ranges deliberately support only exact versions/comparators. */
export interface Semver { major: number; minor: number; patch: number; pre: string[]; build: string[] }
export function parseSemver(value: string): Semver | null {
  if (value.length > 128) return null
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(value)
  if (!match) return null
  const numbers = match.slice(1, 4).map(Number), pre = match[4]?.split('.') ?? []
  if (numbers.some(n => !Number.isSafeInteger(n)) || pre.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) return null
  return { major: numbers[0], minor: numbers[1], patch: numbers[2], pre, build: match[5]?.split('.') ?? [] }
}
function compare(a: Semver, b: Semver): number {
  for (const key of ['major', 'minor', 'patch'] as const) if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny) return x.length === y.length ? x > y ? 1 : -1 : x.length > y.length ? 1 : -1
    return nx !== ny ? nx ? -1 : 1 : x > y ? 1 : -1
  }
  return 0
}
export function parseRange(range: string): Array<{ operator: string; version: Semver }> | null {
  if (!range || range.length > 256 || range.trim() !== range) return null
  const result = []
  const parts = range.split(/ +/)
  for (const part of parts) {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(part)!, version = parseSemver(match[2])
    if (!version || (parts.length > 1 && !match[1])) return null
    result.push({ operator: match[1] ?? '=', version })
  }
  return result
}
export function satisfies(version: string, range: string): boolean {
  const v = parseSemver(version), parts = parseRange(range)
  return !!v && !!parts && parts.every(p => { const c = compare(v, p.version); return p.operator === '>=' ? c >= 0 : p.operator === '<=' ? c <= 0 : p.operator === '>' ? c > 0 : p.operator === '<' ? c < 0 : c === 0 })
}
