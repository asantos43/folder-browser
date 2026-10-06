import type { Filter, Sort } from '@core/table.ts'

/** What the user asked of a table, kept by the key of its tab so that it is as it was when the tab is shown again (the first row as header, the sort, the filters, the query). */
export interface TableOptions {
  header: boolean
  sort: Sort | null
  filters: Filter[]
  query: boolean
  sql: string
}

const options = new Map<string, TableOptions>()
const DEFAULT: TableOptions = { header: true, sort: null, filters: [], query: false, sql: '' }

export const tableOptions = {
  get: (key: string): TableOptions => options.get(key) ?? DEFAULT,
  set: (key: string, value: TableOptions): void => void options.set(key, value),
  delete: (key: string): void => void options.delete(key),
  clear: (): void => options.clear(),
}
