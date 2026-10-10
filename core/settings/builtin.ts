import { defineSetting, type SettingInput } from './registry.ts'

const add = (id: string, type: SettingInput['type'], value: unknown, category: string, label: string, description: string, choices?: readonly unknown[], choiceLabels?: readonly string[]) => defineSetting({ id, type, default: value, category, label, description, choices, choiceLabels, categoryLabel: `settings.${category}` })
export const builtinSettings = [
  add('appearance.theme','choice','auto','appearance','settings.colorTheme','settings.themeHint',['auto','light','dark'],['settings.themeAuto','settings.themeLight','settings.themeDark']),
  add('system.language','choice','auto','appearance','settings.language','settings.languageHint',['auto','en','pt-BR'],['settings.languageAuto','settings.english','settings.portuguese']),
  add('appearance.dividerColour','colour','','appearance','settings.divider','settings.dividerHint'),
  add('tabs.reopenSession','boolean',true,'startup','settings.reopen','settings.reopenHint'),
  add('editor.hotExit','boolean',true,'startup','settings.hotExit','settings.hotExitHint'),
  add('files.showHidden','boolean',false,'files','settings.showHidden','settings.showHiddenHint'),
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
