import { describe, expect, it } from 'vitest'
import { ancestors, buildTree } from './tree.ts'

const files = ['mimetype', 'manifest.json', 'index.html', 'assets/styles/site.css', 'assets/images/logo.png', 'assets/images/10.png', 'assets/images/2.png', '_wsnp/offline.js'].map((path) => ({ path, size: path.length }))

describe('buildTree', () => {
  it('puts folders first and sorts each level by name, with numbers in order', () => {
    const tree = buildTree(files)
    expect(tree.map((n) => n.name)).toEqual(['_wsnp', 'assets', 'index.html', 'manifest.json', 'mimetype'])
    const images = tree[1].children.find((n) => n.name === 'images')!
    expect(images.children.map((n) => n.name)).toEqual(['2.png', '10.png', 'logo.png'])
    expect(tree[1].children.map((n) => n.name)).toEqual(['images', 'styles'])
  })
  it('gives files their size and full path, and folders neither a size nor a file kind', () => {
    const tree = buildTree(files)
    const css = tree[1].children[1].children[0]
    expect(css).toMatchObject({ path: 'assets/styles/site.css', name: 'site.css', folder: false, size: 'assets/styles/site.css'.length })
    expect(tree[1]).toMatchObject({ path: 'assets', folder: true })
    expect(tree[1].size).toBeUndefined()
  })
  it('is empty for no files', () => expect(buildTree([])).toEqual([]))
})

describe('ancestors', () => {
  it('lists the folders that hold a file, outermost first', () => {
    expect(ancestors('assets/images/logo.png')).toEqual(['assets', 'assets/images'])
    expect(ancestors('index.html')).toEqual([])
  })
})
