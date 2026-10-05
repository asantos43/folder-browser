// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { snapshotInfo } from '@/test/fixtures.ts'
import { FileTree } from './FileTree.tsx'

afterEach(cleanup)

function show(activePath?: string) {
  const actions = { onOpen: vi.fn(), onOpenWith: vi.fn(), onSave: vi.fn(), onCopy: vi.fn() }
  const view = render(
    <I18nProvider language="en">
      <FileTree snapshot={snapshotInfo('a')} activePath={activePath} {...actions} />
    </I18nProvider>,
  )
  return { ...actions, view }
}
const names = () => screen.getAllByRole('treeitem').map((r) => r.textContent)

describe('FileTree', () => {
  it('lists folders first, collapsed, then the files', () => {
    show()
    expect(names()).toEqual(['_wsnp', 'assets', 'index.html', 'manifest.json', 'mimetype'])
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe('Files of the snapshot')
    expect(screen.getByRole('treeitem', { name: 'assets' }).getAttribute('aria-expanded')).toBe('false')
  })
  it('opens a folder with a click and shows its content indented', () => {
    show()
    fireEvent.click(screen.getByRole('treeitem', { name: 'assets' }))
    expect(names()).toEqual(['_wsnp', 'assets', 'files', 'images', 'styles', 'index.html', 'manifest.json', 'mimetype'])
    expect(screen.getByRole('treeitem', { name: 'files' }).getAttribute('aria-level')).toBe('2')
  })
  it('opens a preview on a click and keeps the tab on a double click', () => {
    const { onOpen } = show()
    fireEvent.click(screen.getByRole('treeitem', { name: 'index.html' }))
    expect(onOpen).toHaveBeenLastCalledWith('index.html', false)
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'manifest.json' }))
    expect(onOpen).toHaveBeenLastCalledWith('manifest.json', true)
  })
  it('walks with the arrows: right opens then enters a folder, left closes then goes to the parent, Home and End', () => {
    show()
    const tree = screen.getByRole('tree')
    fireEvent.focus(screen.getByRole('treeitem', { name: 'assets' }))
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(screen.getByRole('treeitem', { name: 'assets' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'files' }))
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'assets' }))
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(screen.getByRole('treeitem', { name: 'assets' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(tree, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'mimetype' }))
    fireEvent.keyDown(tree, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: '_wsnp' }))
  })
  it('Enter keeps the file, Space previews it, typing jumps to a name', () => {
    const { onOpen } = show()
    const tree = screen.getByRole('tree')
    fireEvent.focus(screen.getByRole('treeitem', { name: 'index.html' }))
    fireEvent.keyDown(tree, { key: 'Enter' })
    expect(onOpen).toHaveBeenLastCalledWith('index.html', true)
    fireEvent.keyDown(tree, { key: ' ' })
    expect(onOpen).toHaveBeenLastCalledWith('index.html', false)
    fireEvent.keyDown(tree, { key: 'm' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'manifest.json' }))
    fireEvent.keyDown(tree, { key: 'i' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'mimetype' }))
  })
  it('shows the file of the active tab, opening the folders that hold it, and marks it selected', () => {
    show('assets/images/logo.png')
    expect(screen.getByRole('treeitem', { name: 'logo.png' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('treeitem', { name: 'images' }).getAttribute('aria-expanded')).toBe('true')
  })
  it('offers Save As for every file in the context menu, and Copy Path', () => {
    const { onSave, onCopy } = show('assets/files/report.pdf')
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'report.pdf' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save As…' }))
    expect(onSave).toHaveBeenCalledWith('assets/files/report.pdf')
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'index.html' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Path' }))
    expect(onCopy).toHaveBeenCalledWith('index.html')
  })
  it('offers Open With… just under Open, for a file and not for a folder', () => {
    const { onOpen, onOpenWith } = show()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'index.html' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open', 'Open With…', 'Save As…', 'Copy Path'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open With…' }))
    expect(onOpenWith).toHaveBeenCalledWith('index.html')
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'assets' }))
    expect(screen.queryByRole('menuitem', { name: 'Open With…' })).toBeNull()
  })
  it('gives a folder Expand or Collapse, not Save As', () => {
    show()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'assets' }))
    expect(screen.queryByRole('menuitem', { name: 'Save As…' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Expand' }))
    expect(screen.getByRole('treeitem', { name: 'assets' }).getAttribute('aria-expanded')).toBe('true')
  })
})
