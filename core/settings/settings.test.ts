import { describe, expect, it, vi } from 'vitest'
import { builtinSettings } from './builtin.ts'
import { SettingsRegistry, type SettingInput } from './registry.ts'
import { applyImport, exportSettings, previewImport } from './portable.ts'
import { SettingsStore } from './store.ts'

const registry = () => { const r = new SettingsRegistry(); for (const d of builtinSettings) r.defineSetting(d); return r }
const numberDef: SettingInput = { id:'test.count',type:'number',default:2,min:1,max:4,category:'test',label:null }
describe('settings registry', () => {
  it('rejects duplicate ids, wrong types and out of range values; plugin contributions remove atomically', () => {
    const r = new SettingsRegistry(); r.defineSetting(numberDef)
    expect(() => r.defineSetting(numberDef)).toThrow(/already defined/)
    expect(r.validate('test.count','2')).toBe(false); expect(r.validate('test.count',5)).toBe(false)
    const remove = r.contribute([{...numberDef,id:'demo:count'}]); expect(r.get('demo:count')).toBeTruthy(); remove(); expect(r.get('demo:count')).toBeUndefined()
    expect(() => r.contribute([{...numberDef,id:'demo:a'},{...numberDef,id:'test.count'}])).toThrow()
  })
})
describe('settings store and portable settings', () => {
  it('has the 17 current options and resets values', async () => {
    expect(builtinSettings).toHaveLength(17)
    const r = registry(); const write = vi.fn(async (_s:string) => {}); const s = new SettingsStore(r,write)
    s.set('editor.wordWrap',true); s.reset('editor.wordWrap'); await s.flush(); expect(s.get('editor.wordWrap')).toBe(false)
  })
  it('keeps unknown values, warns and defaults invalid known values, and refuses oversized input', () => {
    const s = new SettingsStore(registry(),async()=>{})
    expect(s.load('{"future.value":7,"editor.wordWrap":"yes"}')).toHaveLength(1)
    expect(s.get('editor.wordWrap')).toBe(false)
    expect(() => s.load(' '.repeat(256*1024+1))).toThrow(/256 KB/)
  })
  it('exports only changed values and previews before applying, with safety confirmation', async () => {
    const r = registry(); r.defineSetting({id:'privacy.allowExternal',type:'boolean',default:false,category:'privacy',label:null,safety:true})
    const s = new SettingsStore(r,async()=>{})
    const preview = previewImport('{"editor.wordWrap":true,"privacy.allowExternal":true,"unknown":1}',r,s)
    expect(preview.changes).toHaveLength(3); expect(preview.changes[1].needsConfirm).toBe(true)
    expect(s.get('editor.wordWrap')).toBe(false)
    await expect(applyImport(preview,s)).rejects.toThrow(/Confirmation/)
    await applyImport(preview,s,true); expect(s.get('editor.wordWrap')).toBe(true)
    expect(JSON.parse(exportSettings(s))).toEqual({'editor.wordWrap':true,'privacy.allowExternal':true})
  })
  it('batches 100 sets into one atomic writer call and notifies changed keys only', async () => {
    const r = registry(); const write = vi.fn(async (_s:string) => {}); const s = new SettingsStore(r,write)
    const listener = vi.fn(); s.subscribe(listener)
    for (let i=0;i<100;i++) s.set('editor.wordWrap',i%2===0)
    await new Promise<void>(resolve => queueMicrotask(resolve)); await s.flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls.flat(2).every((x:unknown) => x === 'editor.wordWrap')).toBe(true)
  })
  it('does not alter persisted data when the atomic writer fails', async () => {
    let disk = '{"editor.wordWrap":true}'
    const s = new SettingsStore(registry(),async contents => { if (contents.includes('true')) throw new Error('simulated failure'); disk=contents })
    s.set('files.showHidden',true); await expect(s.flush()).rejects.toThrow('simulated failure')
    expect(disk).toBe('{"editor.wordWrap":true}')
  })
  it('writes unknown keys back (also nested plugin options) and retries after a failed write', async () => {
    const r = registry(); r.defineSetting({ id:'demo:count', type:'number', default:1, category:'demo', label:null })
    let fail = true; const out:string[] = []
    const s = new SettingsStore(r, async c => { if (fail) throw new Error('boom'); out.push(c) })
    s.load('{"future.value":7,"plugins":{"gone":{"x":1}}}')
    s.set('editor.wordWrap',true); s.set('demo:count',3)
    await expect(s.flush()).rejects.toThrow('boom')
    fail = false; await s.flush()
    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0])).toEqual({ 'future.value':7, 'editor.wordWrap':true, plugins:{ gone:{ x:1 }, demo:{ count:3 } } })
  })
  it('loads and validates a 1,000-key file under the 10 ms budget (median of 20 runs)', () => {
    const r = new SettingsRegistry(); const doc:Record<string,boolean> = {}
    for(let i=0;i<1000;i++){ r.defineSetting({id:`bench.group${i}.value`,type:'boolean',default:false,category:'bench',label:null}); doc[`bench.group${i}.value`]=true }
    const json = JSON.stringify(doc); const durations:number[]=[]
    for(let run=0;run<20;run++){ const s = new SettingsStore(r,async()=>{}); const t=performance.now(); s.load(json); durations.push(performance.now()-t) }
    durations.sort((a,b)=>a-b); expect((durations[9]+durations[10])/2).toBeLessThan(10)
  })
  it('validates 1,000 reads under the 10 ms budget (median of 20 runs)', () => {
    const r = new SettingsRegistry(); for(let i=0;i<1000;i++) r.defineSetting({id:`bench.group${i}.value`,type:'boolean',default:false,category:'bench',label:null})
    const durations:number[]=[]
    for(let run=0;run<20;run++){ const start=performance.now(); for(let i=0;i<1000;i++) { const id=`bench.group${i}.value`; r.getDefault(id); r.validate(id,true) } durations.push(performance.now()-start) }
    durations.sort((a,b)=>a-b); expect((durations[9]+durations[10])/2).toBeLessThan(10)
  })
})
