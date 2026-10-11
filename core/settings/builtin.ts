import { defineSetting, type SettingInput } from './registry.ts'
import { normalizeCommands } from '../run.ts'

const add = (id: string, type: SettingInput['type'], value: unknown, category: string, label: string, description: string, choices?: readonly unknown[], choiceLabels?: readonly string[]) => defineSetting({ id, type, default: value, category, label, description, choices, choiceLabels, categoryLabel: `settings.${category}` })
const themePluginId = /^$|^[a-z][\w.-]*:[a-z][\w.-]*$/
/** Availability is host-local; saved preferences survive plugin removal. */
export const isKeySchemeSetting = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 201 && value.trim() === value && /^$|^[a-z][\w.-]*\/[a-z][\w.-]*$/.test(value)
/** Availability is renderer-local; persisted simple BCP47 tags survive plugin removal. */
export const isLanguageSetting = (value: unknown): value is string => typeof value === 'string'
  && (value === 'auto' || (value.length <= 63 && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(value)))
export const builtinSettings = [
  defineSetting({ id: 'keys.scheme', type: 'string', default: '', category: 'keyboard', categoryLabel: 'settings.keyboard', label: 'settings.keyScheme', description: 'settings.keySchemeHint', validator: isKeySchemeSetting }),
  add('appearance.theme','choice','auto','appearance','settings.colorTheme','settings.themeHint',['auto','light','dark'],['settings.themeAuto','settings.themeLight','settings.themeDark']),
  defineSetting({ id: 'appearance.themePlugin', type: 'string', default: '', category: 'appearance', categoryLabel: 'settings.appearance', label: 'settings.colorThemePlugin', description: 'settings.themePluginHint', validator: value => typeof value === 'string' && themePluginId.test(value) && (value === '' || value.length <= 201) }),
  defineSetting({ id: 'system.language', type: 'choice', default: 'auto', category: 'appearance', categoryLabel: 'settings.appearance', label: 'settings.language', description: 'settings.languageHint', validator: isLanguageSetting }),
  add('appearance.dividerColour','colour','','appearance','settings.divider','settings.dividerHint'),
  add('tabs.reopenSession','boolean',true,'startup','settings.reopen','settings.reopenHint'),
  add('editor.hotExit','boolean',true,'startup','settings.hotExit','settings.hotExitHint'),
  add('files.showHidden','boolean',false,'files','settings.showHidden','settings.showHiddenHint'),
  defineSetting({ id: 'files.openWithCommands', type: 'list', default: [], category: 'files', categoryLabel: 'settings.files', label: 'settings.runCommands', description: 'settings.runHint', safety: true, normalize: normalizeCommands, validator: value => Array.isArray(value) && !normalizeCommands(value).warning }),
  add('files.svgView','choice','image','files','settings.svgView','svg.imageTitle',['image','code'],['svg.image','svg.code']),
  add('files.csvView','choice','table','files','settings.csvView','csv.tableTitle',['table','text'],['csv.table','csv.text']),
  add('files.sortKey','choice','name','files','sort.by','settings.sortHint',['name','modified','size'],['sort.name','sort.modified','sort.size']),
  add('files.sortDescending','boolean',false,'files','sort.descending','settings.descendingHint'),
  add('editor.wordWrap','boolean',false,'editor','settings.wordWrap','settings.wordWrapHint'),
  add('editor.formatSource','boolean',true,'editor','settings.formatSource','settings.formatSourceHint'),
  add('editor.markdownView','choice','formatted','editor','settings.markdownView','markdown.formattedTitle',['formatted','text'],['markdown.formatted','markdown.text']),
  add('editor.markdownWide','boolean',false,'editor','markdown.wide','markdown.wideTitle'),
  add('editor.markdownWrapCode','boolean',false,'editor','markdown.wrapCode','markdown.wrapCodeTitle'),
  add('diff.layout','choice','side','diff','settings.diffLayout','diff.sideBySideTitle',['side','inline'],['diff.sideBySide','diff.inline']),
  add('diff.collapseUnchanged','boolean',true,'diff','diff.collapse','diff.collapseTitle'),
]
