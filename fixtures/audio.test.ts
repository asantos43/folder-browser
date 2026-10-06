import { describe, expect, it } from 'vitest'
import { wavBuffer } from './audio.ts'

describe('wavBuffer', () => {
  it('is a WAV of the length asked, with a header that says so', () => {
    const wav = wavBuffer(2, 440, 8000)
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.subarray(8, 16).toString()).toBe('WAVEfmt ')
    expect(wav.readUInt32LE(24)).toBe(8000)
    expect(wav.readUInt32LE(40)).toBe(2 * 8000 * 2)
    expect(wav.length).toBe(44 + 2 * 8000 * 2)
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
  })
  it('is not silence', () => expect(wavBuffer(0.1).subarray(44).some((b) => b !== 0)).toBe(true))
})
