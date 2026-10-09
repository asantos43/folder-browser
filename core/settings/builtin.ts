import { defineSetting } from './registry.ts'

const add = (id: string, type: 'boolean'|'choice'|'colour', value: unknown, category: string, label: string | null, choices?: readonly unknown[]) => defineSetting({ id, type, default: value, category, label, choices })
export const builtinSettings = [
  add('editor.wordWrap','boolean',false,'editor','settings.wordWrap'),
  add('files.svgView','choice','image','files',null,['image','code']),
  add('files.csvView','choice','table','files',null,['table','text']),
  add('editor.markdownView','choice','formatted','editor',null,['formatted','text']),
  add('editor.markdownWide','boolean',false,'editor',null),
  add('editor.markdownWrapCode','boolean',false,'editor',null),
  add('tabs.reopenSession','boolean',true,'tabs','settings.reopen'),
  add('appearance.dividerColour','colour','','appearance','settings.divider'),
  add('editor.hotExit','boolean',true,'editor','settings.hotExit'),
  add('files.showHidden','boolean',false,'files','settings.showHidden'),
  defineSetting({id:'files.sortKey',type:'choice',default:'name',category:'files',label:null,choices:['name','modified','size']}),
  add('files.sortDescending','boolean',false,'files',null),
  add('editor.formatSource','boolean',true,'editor','settings.formatSource'),
  defineSetting({id:'diff.layout',type:'choice',default:'side',category:'diff',label:null,choices:['side','inline']}),
  add('diff.collapseUnchanged','boolean',true,'diff',null),
  defineSetting({id:'appearance.theme',type:'choice',default:'auto',category:'appearance',label:'settings.colorTheme',choices:['auto','light','dark']}),
  defineSetting({id:'system.language',type:'choice',default:'auto',category:'system',label:'settings.language',choices:['auto','en','pt-BR']}),
]
