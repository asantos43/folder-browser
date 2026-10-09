import { expect, it } from 'vitest'
import { eventChord, formatChord, normalizeChord, parseChord } from './chord.ts'

it('parses, normalizes and formats valid chords and rejects malformed chords', () => {
  const cases = [
    ['Mod+Shift+S', false, 'CS:s', 'Ctrl+Shift+S', 'Ctrl+Shift+S'],
    ['Mod+Shift+S', true, 'MS:s', '⇧⌘S', 'Cmd+Shift+S'],
    ['Ctrl+Tab', true, 'C:Tab', '⌃Tab', 'Ctrl+Tab'],
    [' shift + option + cmd + p ', true, 'MSA:p', '⌥⇧⌘P', 'Cmd+Alt+Shift+P'],
    ['Alt+Left', false, 'A:ArrowLeft', 'Alt+Left', 'Alt+Left'],
    ['Mod++', false, 'C:+', 'Ctrl++', 'Ctrl++'],
    ['Mod+Shift+Plus', true, 'MS:+', '⇧⌘+', 'Cmd+Shift++'],
    ['F1', false, ':F1', 'F1', 'F1'],
    ['Space', false, ': ', 'Space', 'Space'],
    ['+', false, ':+', '+', '+'],
  ] as const
  for (const [input, mac, normalized, display, accelerator] of cases) {
    expect(normalizeChord(input, mac), input).toBe(normalized)
    expect(eventChord(parseChord(input, mac)), input).toBe(normalized)
    expect(formatChord(input, mac), input).toBe(display)
    expect(formatChord(input, mac, 'accelerator'), input).toBe(accelerator)
  }
  for (const input of ['', ' ', 'Ctrl', 'Ctrl+', 'Ctrl++S', 'Hyper+S', 'Ctrl+Ctrl+S', 'Mod+Cmd+S', 'F13', 'Ctrl+Unknown', 'Ctrl+S+P', '__proto__', 'constructor']) {
    expect(() => parseChord(input, true), input).toThrow('Invalid key chord')
  }
})
