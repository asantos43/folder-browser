/** Validate the type-only contract and preserve its TSDoc in a future declaration file.
 * This intentionally accepts only the small standalone syntax used by contract.ts.
 */
export function contractDeclaration(source: string): { names: readonly string[]; text: string } {
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const names = [...uncommented.matchAll(/^export (?:interface|type) ([A-Za-z][A-Za-z0-9]*)\b/gm)].map(match => match[1])
  if (!names.length || new Set(names).size !== names.length || /\b(?:import|function|class|const|let|var|namespace|declare)\b/.test(uncommented)) throw new Error('Contract must contain only unique exported types')
  const exports = [...uncommented.matchAll(/\bexport\b/g)]
  if (exports.length !== names.length) throw new Error('Unexpected contract export')
  return { names: Object.freeze(names), text: source.trim() + '\n' }
}
