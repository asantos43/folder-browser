import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chooseFrom, dataDirs, desktopLanguage, findIcon, mimeDescription, parseDesktopEntry, parseMimeOutput, scanApplications, type Runner } from './apps.ts'

const entry = (lines: string[]) => `[Desktop Entry]\n${lines.join('\n')}\n`

describe('parseDesktopEntry', () => {
  const viewer = entry(['Type=Application', 'Name=Image Viewer', 'Name[pt_BR]=Visualizador de Imagens', 'Name[de]=Bildbetrachter', 'Icon=org.gnome.Loupe', 'Exec=loupe %U', 'MimeType=image/png;'])
  it('reads the name in the language of the desktop, then its base language, then the plain one', () => {
    expect(parseDesktopEntry(viewer, 'loupe.desktop', '/x', 'pt_BR')?.name).toBe('Visualizador de Imagens')
    expect(parseDesktopEntry(viewer, 'loupe.desktop', '/x', 'de_AT')?.name).toBe('Bildbetrachter')
    expect(parseDesktopEntry(viewer, 'loupe.desktop', '/x', 'fr_FR')?.name).toBe('Image Viewer')
    expect(parseDesktopEntry(viewer, 'loupe.desktop', '/x')).toEqual({ id: 'loupe.desktop', name: 'Image Viewer', icon: 'org.gnome.Loupe', file: '/x' })
  })
  it('leaves out what is not an application to show, or cannot be given a file', () => {
    expect(parseDesktopEntry(entry(['Type=Application', 'Name=A', 'Exec=a %f', 'NoDisplay=true']), 'a.desktop', '/x')).toBeNull()
    expect(parseDesktopEntry(entry(['Type=Application', 'Name=A', 'Exec=a %f', 'Hidden=true']), 'a.desktop', '/x')).toBeNull()
    expect(parseDesktopEntry(entry(['Type=Link', 'Name=A', 'Exec=a %f']), 'a.desktop', '/x')).toBeNull()
    expect(parseDesktopEntry(entry(['Type=Application', 'Name=Settings', 'Exec=settings']), 'a.desktop', '/x')).toBeNull()
    expect(parseDesktopEntry(entry(['Type=Application', 'Exec=a %f']), 'a.desktop', '/x')).toBeNull()
    expect(parseDesktopEntry('not a desktop file', 'a.desktop', '/x')).toBeNull()
  })
  it('reads only the Desktop Entry group, not an action of it', () => {
    const text = entry(['Type=Application', 'Name=Main', 'Exec=main %F']) + '\n[Desktop Action new]\nName=New window\nExec=main --new\n'
    expect(parseDesktopEntry(text, 'm.desktop', '/x')?.name).toBe('Main')
  })
})

describe('parseMimeOutput', () => {
  it('reads the default, the registered and the recommended applications of `gio mime`', () => {
    const out = 'Default application for “image/png”: org.gnome.Loupe.desktop\nRegistered applications:\n\ta.desktop\n\torg.gnome.Loupe.desktop\nRecommended applications:\n\torg.gnome.Loupe.desktop\n'
    expect(parseMimeOutput(out)).toEqual({ default: 'org.gnome.Loupe.desktop', registered: ['a.desktop', 'org.gnome.Loupe.desktop'], recommended: ['org.gnome.Loupe.desktop'] })
  })
  it('reads a type that nothing opens', () => {
    expect(parseMimeOutput('No default applications for “application/x-none”\nNo registered applications\nNo recommended applications\n')).toEqual({ default: undefined, registered: [], recommended: [] })
  })
})

describe('dataDirs and desktopLanguage', () => {
  it('puts the user’s folder first, then the system’s, then Flatpak’s', () => {
    expect(dataDirs({ XDG_DATA_HOME: '/h/share', XDG_DATA_DIRS: '/a:/b' }, '/home/me')).toEqual(['/h/share', '/a', '/b', path.join('/home/me', '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share'])
    expect(dataDirs({}, '/home/me')[0]).toBe(path.join('/home/me', '.local/share'))
  })
  it('reads the language from the usual variables', () => {
    expect(desktopLanguage({ LANG: 'pt_BR.UTF-8' })).toBe('pt_BR')
    expect(desktopLanguage({ LC_ALL: 'de_DE.utf8', LANG: 'pt_BR.UTF-8' })).toBe('de_DE')
    expect(desktopLanguage({ LANGUAGE: 'fr:en', LANG: 'C' })).toBe('fr')
    expect(desktopLanguage({})).toBe('')
  })
})

describe('what is on disk', () => {
  let root: string
  let share: string
  let user: string
  const write = (file: string, text: string | Buffer) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-apps-'))
    share = path.join(root, 'share')
    user = path.join(root, 'user')
    write(path.join(share, 'applications/loupe.desktop'), entry(['Type=Application', 'Name=Image Viewer', 'Icon=loupe', 'Exec=loupe %U']))
    write(path.join(share, 'applications/pinta.desktop'), entry(['Type=Application', 'Name=Pinta', 'Icon=pinta', 'Exec=pinta %F']))
    write(path.join(share, 'applications/editor.desktop'), entry(['Type=Application', 'Name=Text Editor', 'Icon=/abs/none.png', 'Exec=editor %f']))
    write(path.join(share, 'applications/hidden.desktop'), entry(['Type=Application', 'Name=Hidden', 'Exec=h %f', 'NoDisplay=true']))
    write(path.join(share, 'applications/sub/deep.desktop'), entry(['Type=Application', 'Name=Deep', 'Exec=deep %f']))
    // The user's own copy of an id wins over the system's.
    write(path.join(user, 'applications/pinta.desktop'), entry(['Type=Application', 'Name=Pinta (mine)', 'Icon=pinta', 'Exec=pinta %F']))
    write(path.join(share, 'icons/hicolor/48x48/apps/loupe.png'), Buffer.from([137, 80, 78, 71]))
    write(path.join(share, 'icons/hicolor/scalable/apps/pinta.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    write(path.join(share, 'icons/hicolor/128x128/apps/loupe.png'), Buffer.from([137, 80, 78, 71, 1]))
    write(path.join(share, 'mime/image/png.xml'), '<mime-type type="image/png"><comment>PNG image</comment><comment xml:lang="pt_BR">Imagem PNG</comment></mime-type>')
  })
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  it('scans the applications of the folders: the first file of an id wins, the subfolders count, and they are sorted by name', async () => {
    const apps = await scanApplications([user, share])
    expect(apps.map((a) => [a.id, a.name])).toEqual([
      ['sub-deep.desktop', 'Deep'],
      ['loupe.desktop', 'Image Viewer'],
      ['pinta.desktop', 'Pinta (mine)'],
      ['editor.desktop', 'Text Editor'],
    ])
  })

  it('finds an icon by name in the themes, the biggest size asked for first, and as a path', async () => {
    const png = await findIcon('loupe', [share])
    expect(png).toBe(`data:image/png;base64,${Buffer.from([137, 80, 78, 71, 1]).toString('base64')}`)
    expect(await findIcon('pinta', [share])).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(await findIcon(path.join(share, 'icons/hicolor/48x48/apps/loupe.png'), [])).toMatch(/^data:image\/png/)
    expect(await findIcon('nothing-like-it', [share])).toBeUndefined()
    expect(await findIcon('', [share])).toBeUndefined()
    expect(await findIcon('/abs/none.png', [share])).toBeUndefined()
  })

  it('names a type in words, in the language of the desktop where it can', async () => {
    expect(await mimeDescription('image/png', [share])).toBe('PNG image')
    expect(await mimeDescription('image/png', [share], 'pt_BR')).toBe('Imagem PNG')
    expect(await mimeDescription('image/x-unknown', [share])).toBe('image/x-unknown')
  })

  it('offers for a file: the applications registered for its type first, the default the first of them, then all the others', async () => {
    const run: Runner = async (command, args) => {
      if (command === 'gio' && args[0] === 'info') return 'attributes:\n  standard::content-type: image/png\n'
      if (command === 'gio' && args[0] === 'mime') return 'Default application for “image/png”: pinta.desktop\nRegistered applications:\n\tloupe.desktop\n\tpinta.desktop\n\tgone.desktop\nRecommended applications:\n\tloupe.desktop\n\tpinta.desktop\n'
      throw new Error('no such command')
    }
    const choices = await chooseFrom('/tmp/a.png', run, { LANG: 'en_US.UTF-8' }, [user, share])
    expect(choices.mime).toBe('image/png')
    expect(choices.mimeLabel).toBe('PNG image')
    expect(choices.apps.map((a) => [a.id, a.recommended])).toEqual([['pinta.desktop', true], ['loupe.desktop', true], ['sub-deep.desktop', false], ['editor.desktop', false]])
    expect(choices.apps[1].iconUrl).toMatch(/^data:image\/png/)
    expect(choices.apps[3].iconUrl).toBeUndefined()
  })

  it('still offers every application when the desktop knows none for the type, and says the type is unknown when gio does not', async () => {
    const run: Runner = async (command, args) => {
      if (args[0] === 'info') return ''
      if (command === 'gio' && args[0] === 'mime') return 'No default applications for “application/octet-stream”\nNo registered applications\nNo recommended applications\n'
      throw new Error('no')
    }
    const choices = await chooseFrom('/tmp/x.bin', run, {}, [user, share])
    expect(choices.mime).toBe('application/octet-stream')
    expect(choices.apps.every((a) => !a.recommended)).toBe(true)
    expect(choices.apps).toHaveLength(4)
  })
})
