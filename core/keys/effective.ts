import { builtinKeyCommands } from '../commands/builtin.ts'
import { builtinKeyTables } from './table.ts'
import { mergeUserKeys, type UserKey } from './user.ts'

type EffectiveTable = ReturnType<typeof mergeUserKeys>['table']
let macTable: EffectiveTable = builtinKeyTables.mac
let otherTable: EffectiveTable = builtinKeyTables.nonmac
export function effectiveKeyTable(mac: boolean): EffectiveTable { return mac ? macTable : otherTable }
export function setUserKeys(entries: readonly UserKey[], mac: boolean): void {
  const table = entries.length ? mergeUserKeys(builtinKeyCommands, entries, mac).table : (mac ? builtinKeyTables.mac : builtinKeyTables.nonmac)
  if (mac) macTable = table
  else otherTable = table
}
