import type { FbApi } from '@core/api.ts'
import { NONE, wrap, type FindOptions, type FindState, type FindTarget } from './types.ts'

/**
 * Find in the page of a snapshot: the page is another process, so the main process runs the browser's own `find` in its frame. It
 * says whether there was a match and how many there are; which one is current is followed here, as the steps go.
 */
export function createFrameFindTarget(api: Pick<FbApi, 'findInPage' | 'clearFindInPage'>, id: string): FindTarget {
  let count = 0
  let index = 0
  let last: { query: string; caseSensitive: boolean } | null = null
  return {
    async search(query: string, options: FindOptions): Promise<FindState> {
      last = { query, caseSensitive: options.caseSensitive }
      if (!query) {
        count = index = 0
        await api.clearFindInPage(id)
        return NONE
      }
      const result = await api.findInPage(id, query, { caseSensitive: options.caseSensitive, backwards: false, reset: true, count: true })
      count = result.found ? Math.max(1, result.count) : 0
      index = count ? 1 : 0
      return { count, index }
    },
    async step(direction: 1 | -1): Promise<FindState> {
      if (!last?.query || !count) return NONE
      const result = await api.findInPage(id, last.query, { caseSensitive: last.caseSensitive, backwards: direction < 0, reset: false, count: false })
      if (!result.found) return { count, index }
      index = wrap(index - 1 + direction, count) + 1
      return { count, index }
    },
    clear() {
      last = null
      count = index = 0
      void api.clearFindInPage(id)
    },
  }
}
