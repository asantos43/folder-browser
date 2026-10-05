export interface TreeNode {
  /** Path in the archive (`assets/images`, `assets/images/logo.png`). */
  path: string
  name: string
  /** Folders have children and no size. */
  folder: boolean
  size?: number
  children: TreeNode[]
}

/** The files of an archive as a tree: folders first, each level in name order, as VS Code's Explorer sorts. */
export function buildTree(files: readonly { path: string; size: number }[]): TreeNode[] {
  const root: TreeNode = { path: '', name: '', folder: true, children: [] }
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let level = root
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const last = i === parts.length - 1
      let node = level.children.find((c) => c.name === name && c.folder === !last)
      if (!node) {
        node = { path, name, folder: !last, ...(last ? { size: file.size } : {}), children: [] }
        level.children.push(node)
      }
      level = node
    })
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }))
    for (const node of nodes) sort(node.children)
  }
  sort(root.children)
  return root.children
}

/** Paths of every folder that contains the given file, outermost first: what must be open for the file to be visible. */
export const ancestors = (path: string): string[] => {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}
