import { compileWhen, type WhenContext } from '../commands/when.ts'
import type { ContributionMenuItem, MenuPoint } from './contract.ts'

/** Separate install-time registry; no renderer or built-in menu is changed at import. */
export function createMenuRegistry() {
  const items = new Map<string, { item: Readonly<ContributionMenuItem>; condition?: (context: WhenContext) => boolean }>()
  return {
    add(item: ContributionMenuItem): void {
      if (items.has(item.id)) throw new Error(`Menu item already registered: ${item.id}`)
      const condition = item.when === undefined ? undefined : compileWhen(item.when)
      items.set(item.id, { item: Object.freeze({ ...item }), condition })
    },
    get(id: string): Readonly<ContributionMenuItem> | undefined { return items.get(id)?.item },
    remove(id: string): void { items.delete(id) },
    all(): readonly Readonly<ContributionMenuItem>[] { return [...items.values()].map(entry => entry.item) },
    at(point: MenuPoint, context: WhenContext = {}): readonly Readonly<ContributionMenuItem>[] {
      return [...items.values()].filter(entry => entry.item.point === point && (!entry.condition || entry.condition(context))).map(entry => entry.item)
        .sort((a, b) => a.group < b.group ? -1 : a.group > b.group ? 1 : a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    },
  }
}

/** Append projected contributions without editing/reordering the existing built-in entries. */
export function contributedMenu<T>(registry: ReturnType<typeof createMenuRegistry>, point: MenuPoint, builtin: readonly T[], project: (item: Readonly<ContributionMenuItem>) => T, context: WhenContext = {}): readonly T[] {
  const entries = registry.at(point, context)
  return entries.length ? [...builtin, ...entries.map(project)] : builtin
}
