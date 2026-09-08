import { describe,it,expect } from 'vitest';
import { caseNumber,duration,id,integer,SerialQueue,evidenceUrl } from '../src/utils/core.js';
import { parsePrefix } from '../src/commands/prefix/parser.js';
import { parseSlash } from '../src/commands/slash/parser.js';
import { definitions,slashDefinitions } from '../src/commands/definitions.js';
describe('input and routing',()=> {
  it('validates IDs without numeric precision loss',()=> {
    expect(id('<@!123456789012345678>')).toBe('123456789012345678');
    expect(()=>id('123')).toThrow(); expect(()=>id('1e18')).toThrow();
    expect(caseNumber(12)).toBe('VE-000012'); expect(caseNumber(1000000)).toBe('VE-1000000');
  });
  it('bounds durations and channel counts',()=> {
    expect(duration('28d')).toBe(2419200); expect(duration('1h')).toBe(3600);
    for (const v of ['29d','0m','-1h','1.5h']) expect(()=>duration(v)).toThrow();
    expect(()=>integer('101',1,100)).toThrow(); expect(()=>integer('1x',1,100)).toThrow();
    expect(()=>evidenceUrl('javascript:alert(1)')).toThrow();
  });
  it('parses free-form reasons, aliases and optional evidence',()=> {
    const result=parsePrefix('-gb 123456789012345678 Ban evasion --evidence https://example.com/proof','-')!;
    expect(result.definition.name).toBe('globalban');
    expect(result.args).toEqual({user:'123456789012345678',reason:'Ban evasion',evidence:'https://example.com/proof'});
    expect(parsePrefix('-case VE-000003','-')?.sub).toBe('view');
    expect(parsePrefix('-config','-')?.sub).toBe('view');
    expect(()=>parsePrefix('-enforcement remove 123456789012345678 --cleanup','-')).toThrow();
  });
  it('prefix and slash produce identical warning invocations',()=> {
    const values={user:'123456789012345678',reason:'Repeated spam'};
    const slash=parseSlash({commandName:'warn',options:{getSubcommand:()=>null,getString:(key:keyof typeof values)=>values[key]}} as any);
    expect(slash).toEqual(parsePrefix('-warn 123456789012345678 Repeated spam','-'));
  });
  it('registers every command and subcommand, with required options first',()=> {
    const commands=slashDefinitions();
    expect(commands).toHaveLength(definitions.length);
    expect(new Set(commands.map(c=>c.name)).size).toBe(commands.length);
    expect(commands.find(c=>c.name==='warn')?.options?.map(o=>o.name)).toEqual(['user','reason']);
    for (const def of definitions) {
      const options=def.subcommands?.map(s=>s.options??[]) ?? [def.options??[]];
      for (const list of options) { let optional=false; for(const o of list) { if(o.required===false) optional=true; else expect(optional).toBe(false); } }
    }
  });
  it('serializes mutations and continues after failures',async()=> {
    const q=new SerialQueue(),order:string[]=[];
    const a=q.run(async()=>{order.push('a');throw new Error('fail');});
    const b=q.run(async()=>{order.push('b');return 2;});
    await expect(a).rejects.toThrow(); await expect(b).resolves.toBe(2); expect(order).toEqual(['a','b']);
  });
});
