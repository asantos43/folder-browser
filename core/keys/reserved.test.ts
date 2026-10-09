import { expect, it } from 'vitest'
import { assertPluginChord, isReserved } from './reserved.ts'

it('protects application, system and focused editing chords from plugins on both platforms', () => {
  for (const mac of [false, true]) {
    for (const chord of ['Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z', 'Mod+Shift+Z', 'Mod+S', 'Mod+Alt+S', 'F1', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Mod+Q', 'Alt+F4', 'F11', 'ArrowLeft', 'Shift+ArrowRight', 'Backspace', 'Delete', 'Enter', 'Tab', 'Escape']) {
      expect(isReserved(chord, mac), chord).toBe(true)
      expect(() => assertPluginChord(chord, mac), chord).toThrow('Reserved key chord')
    }
    for (const chord of ['Mod+Shift+J', 'Alt+F8', 'F12']) {
      expect(isReserved(chord, mac), chord).toBe(false)
      expect(() => assertPluginChord(chord, mac)).not.toThrow()
    }
    expect(isReserved(mac ? 'Cmd+C' : 'Ctrl+C', mac)).toBe(true)
    expect(isReserved(mac ? 'Ctrl+-' : 'Alt+Left', mac)).toBe(true)
    expect(isReserved(mac ? 'Cmd+9' : 'Alt+9', mac)).toBe(true)
  }
  expect(isReserved('Ctrl+Y', false)).toBe(true)
  expect(isReserved('Ctrl+Y', true)).toBe(false)
  expect(isReserved('Cmd+Alt+H', true)).toBe(true)
  expect(() => assertPluginChord('Invalid+Key', true)).toThrow('Invalid key chord')
})
