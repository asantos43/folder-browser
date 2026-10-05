/**
 * How well `query` matches `text`, as VS Code's quick open does it: every letter of the query must appear in the text, in order.
 * A match at the start scores highest, then a whole word, then a run of letters together; `null` when it does not match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  const whole = t.indexOf(q)
  if (whole === 0) return 1000 - t.length
  if (whole > 0) return (/[\s/._-]/.test(t[whole - 1]) ? 800 : 600) - whole
  let score = 0
  let at = 0
  let run = 0
  for (const ch of q) {
    const found = t.indexOf(ch, at)
    if (found < 0) return null
    run = found === at ? run + 1 : 0
    score += 10 + run * 5 - Math.min(found - at, 10)
    at = found + 1
  }
  return score
}
