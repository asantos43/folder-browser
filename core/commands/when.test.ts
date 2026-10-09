import { describe, expect, it } from 'vitest'
import { compileWhen } from './when.ts'

describe('compileWhen', () => {
  it.each([
    ['editor && !readonly', { editor: true, readonly: false }, true],
    ['editor && !readonly', { editor: true, readonly: true }, false],
    ["mode == 'text'", { mode: 'text' }, true],
    ["mode != 'text'", { mode: 'hex' }, true],
    ["(editor || snapshot) && mode == 'text'", { editor: false, snapshot: true, mode: 'text' }, true],
    ["!missing || mode == 'text'", { mode: 'hex' }, true],
  ])('%s', (expression, context, expected) => expect(compileWhen(expression)(context)).toBe(expected))

  it.each(['', 'a &&', '|| a', '(a', 'a)', "x == y", 'x === 1', "x == 'unterminated", "x == 'a'; globalThis.pwned=true", 'a ?? b'])('rejects malformed expression %s', (expression) => {
    expect(() => compileWhen(expression)).toThrow(SyntaxError)
  })
})
