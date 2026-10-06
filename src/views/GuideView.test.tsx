// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { GuideView } from './GuideView.tsx'

const GUIDE = '# User guide\n\nSee [the groups](#two-editor-groups) and [the site](https://example.com/).\n\n![A table](images/table.png)\n\n## Two editor groups\n\nText.\n'
const asked: string[] = []

beforeEach(() => {
  asked.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (asked.push(url), url.includes('missing') ? new Response('', { status: 404 }) : new Response(url.includes('pt-BR') ? '# Guia do usuário\n' : GUIDE))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as { fb?: unknown }).fb
})

describe('GuideView', () => {
  it('reads the guide in the language of the interface from the build, and draws it with its picture', async () => {
    render(
      <I18nProvider language="en">
        <GuideView />
      </I18nProvider>,
    )
    expect(screen.getByText('Loading the guide…')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'User guide' })).toBeTruthy())
    expect(asked).toEqual(['./guide/USER-GUIDE.md'])
    expect(screen.getByRole('img', { name: 'A table' }).getAttribute('src')).toBe('./guide/images/table.png')
  })

  it('reads the Portuguese guide when the interface is in Portuguese', async () => {
    render(
      <I18nProvider language="pt-BR">
        <GuideView />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Guia do usuário' })).toBeTruthy())
    expect(asked).toEqual(['./guide/USER-GUIDE.pt-BR.md'])
  })

  it('a link inside the guide scrolls to its heading, and a link to the web opens in the browser', async () => {
    const openExternal = vi.fn()
    ;(window as { fb?: unknown }).fb = { openExternal }
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    render(
      <I18nProvider language="en">
        <GuideView />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByRole('link', { name: 'the groups' })).toBeTruthy())
    fireEvent.click(screen.getByRole('link', { name: 'the groups' }))
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'the site' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com/')
  })

  it('says so when the guide cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    render(
      <I18nProvider language="en">
        <GuideView />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByText('The guide could not be read.')).toBeTruthy())
  })
})
