import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { indexesOf, NONE, wrap, type FindOptions, type FindState, type SyncFindTarget } from './types.ts'

interface Match {
  from: number
  to: number
}
interface Found {
  matches: Match[]
  current: number
}

const setFound = StateEffect.define<Found>()
const none: Found = { matches: [], current: -1 }

const found = StateField.define<Found>({
  create: () => none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFound)) return effect.value
    return tr.docChanged ? none : value
  },
})

const mark = Decoration.mark({ class: 'cm-wsnpMatch' })
const markCurrent = Decoration.mark({ class: 'cm-wsnpMatch cm-wsnpMatch-current' })

/** Draws the matches that are on screen (the editor draws only those lines anyway), the current one apart. */
const matches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setFound)))) this.decorations = this.build(update.view)
    }
    build(view: EditorView): DecorationSet {
      const { matches: all, current } = view.state.field(found)
      const builder = new RangeSetBuilder<Decoration>()
      let last = -1
      for (const range of view.visibleRanges) {
        // The first match that ends after the start of this range (they are in order).
        let lo = 0
        let hi = all.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (all[mid].to <= range.from) lo = mid + 1
          else hi = mid
        }
        for (let i = lo; i < all.length && all[i].from < range.to; i++) {
          if (all[i].from < last) continue
          builder.add(all[i].from, all[i].to, i === current ? markCurrent : mark)
          last = all[i].to
        }
      }
      return builder.finish()
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** What an editor needs to show the matches of a search; the search itself is `createCodeFindTarget`. */
export const findExtension = [found, matches]

/**
 * Find in the source editor, over the whole text (the editor draws only the lines in view): every match is counted, the current one is
 * drawn apart and scrolled to the middle of the window. The first is the first one at or below the top of what is shown.
 */
export function createCodeFindTarget(getView: () => EditorView | null): SyncFindTarget {
  let current = 0
  let all: Match[] = []
  const show = (view: EditorView): FindState => {
    if (!all.length) {
      view.dispatch({ effects: setFound.of(none) })
      return NONE
    }
    view.dispatch({ effects: [setFound.of({ matches: all, current }), EditorView.scrollIntoView(all[current].from, { y: 'center' })] })
    return { count: all.length, index: current + 1 }
  }
  return {
    search(query: string, options: FindOptions) {
      const view = getView()
      all = []
      current = 0
      if (!view) return NONE
      if (query) {
        all = indexesOf(view.state.doc.toString(), query, options.caseSensitive).map((from) => ({ from, to: from + query.length }))
        const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from
        current = Math.max(0, all.findIndex((m) => m.from >= top))
      }
      return show(view)
    },
    step(direction) {
      const view = getView()
      if (!view || !all.length) return NONE
      current = wrap(current + direction, all.length)
      return show(view)
    },
    clear() {
      all = []
      const view = getView()
      if (view) view.dispatch({ effects: setFound.of(none) })
    },
    selectAll() {
      const view = getView()
      if (!view) return
      view.focus()
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    },
    selectedText() {
      const view = getView()
      const range = view?.state.selection.main
      return view && range && !range.empty ? view.state.sliceDoc(range.from, range.to) : ''
    },
  }
}
