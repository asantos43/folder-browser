import type { OpenResult } from '@core/api.ts'
import { describe, expect, it } from 'vitest'
import { translator } from '@/i18n/index.ts'
import { refusalNotice } from './messages.ts'

const refused = (issues: Extract<OpenResult, { ok: false }>['issues'], omitted = 0): Extract<OpenResult, { ok: false }> => ({ ok: false, path: '/home/me/Trip.wsnp', issues, omitted })
const en = translator('en')

describe('refusalNotice', () => {
  it('says why in plain words, with the file name and no path', () => {
    const notice = refusalNotice(en, refused([{ code: 'not-zip' }]))
    expect(notice).toEqual({ level: 'error', text: 'Could not open Trip.wsnp: This is not a WSNP file: it is not a ZIP archive.' })
  })
  it('says a newer version, an application and a password are things the viewer cannot do yet, gently', () => {
    for (const [code, words] of [['newer-version', 'newer version'], ['application', 'application'], ['protected', 'password']] as const) {
      const notice = refusalNotice(en, refused([{ code }]))
      expect(notice.level).toBe('info')
      expect(notice.text).toContain('can’t be opened')
      expect(notice.text).toContain(words)
    }
  })
  it('names the file that is at fault and counts the other problems', () => {
    const notice = refusalNotice(en, refused([{ code: 'file-missing', path: 'assets/images/a.png' }, { code: 'size-mismatch', path: 'x' }], 3))
    expect(notice.text).toContain('assets/images/a.png is listed in the manifest but is not in the file.')
    expect(notice.text).toContain('(4 more problems.)')
    expect(refusalNotice(en, refused([{ code: 'field', field: 'title' }, { code: 'field', field: 'created' }])).text).toContain('(1 more problem.)')
  })
  it('speaks Portuguese too', () => {
    expect(refusalNotice(translator('pt-BR'), refused([{ code: 'application' }])).text).toBe('Trip.wsnp não pode ser aberto: Ele contém um aplicativo que este visualizador ainda não consegue executar.')
  })
})
