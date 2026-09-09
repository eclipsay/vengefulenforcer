import {describe,it,expect,vi} from 'vitest';
import {ApplicationCommandOptionType,PermissionFlagsBits as P,PermissionsBitField} from 'discord.js';
import {userId,embed} from '../src/utils/core.js';
import {createRegistry} from '../src/commands/registry.js';
import {parsePrefix} from '../src/commands/prefix/parser.js';
import {parseSlash} from '../src/commands/slash/parser.js';
import {slashDefinitions} from '../src/commands/definitions.js';
import {PermissionService} from '../src/services/permissionService.js';
import {CaseService} from '../src/services/caseService.js';

const target='123456789012345679'; // Number(target) cannot preserve the last digit.
describe('Discord user ID support',()=> {
  it('normalizes raw IDs and both user mention formats without losing precision',()=> {
    for(const input of [target,`<@${target}>`,`<@!${target}>`,`  ${target}  `]) expect(userId(input)).toBe(target);
    for(const input of [`<@&${target}>`,`<#${target}>`,'@Someone','Someone','1e18','18446744073709551616']) expect(()=>userId(input)).toThrow();
  });
  const routes=[
    ...['ban','unban','kick','timeout','untimeout','warn'].map(name=>({name,sub:undefined,service:'moderation',method:'punish',targetIndex:2,extra:name==='timeout'?{duration:'1h',reason:'Reason'}:{reason:'Reason'}})),
    ...['globalban','globalunban'].map(name=>({name,sub:undefined,service:'global',method:name==='globalban'?'globalBan':'globalUnban',targetIndex:1,extra:{reason:'Reason'}})),
    {name:'globaltempban',sub:undefined,service:'global',method:'globalTempBan',targetIndex:1,extra:{duration:'1h',reason:'Reason'}},
    ...['notes','warnings','history'].map(name=>({name,sub:undefined,service:'records',method:'notes',targetIndex:1,extra:{}})),
    {name:'note',sub:'add',service:'records',method:'note',targetIndex:2,extra:{text:'Note text'}},
  ];
  it.each(routes)('$name $sub accepts IDs and mentions through both command systems',async route=> {
    for(const input of [target,`<@${target}>`,`<@!${target}>`]) {
      for(const style of ['prefix','slash']) {
        const method=vi.fn().mockResolvedValue(['history','notes'].includes(route.method)?{pages:1,embed:embed('TEST','Saved records')}:'Saved');
        const services:any={permissions:{check:vi.fn()},[route.service]:{[route.method]:method}};
        const ctx:any={reply:vi.fn().mockResolvedValue({})};
        const args:any={user:input,...route.extra};
        const invocation=style==='prefix'
          ?parsePrefix('-'+route.name+(route.sub?' '+route.sub:'')+' '+input+' '+Object.values(route.extra).join(' '),'-')!
          :parseSlash({commandName:route.name,options:{getSubcommand:()=>route.sub??null,getString:(key:string)=>args[key]??null}} as any)!;
        await createRegistry(services,'-')(ctx,invocation);
        expect(method.mock.calls[0][route.targetIndex]).toBe(target);
      }
    }
  });
  it('registers user arguments as strings so absent users can be entered by ID',()=> {
    for(const command of slashDefinitions()) {
      const options=command.options??[];
      const all=options.flatMap(o=>o.type===ApplicationCommandOptionType.Subcommand?o.options??[]:[o]);
      for(const option of all.filter(o=>o.name==='user')) expect(option.type).toBe(ApplicationCommandOptionType.String);
    }
  });
  it('permits bans and warnings for an ID not in the guild, with clear errors for kicks/timeouts',async()=> {
    const guild:any={ownerId:'owner',client:{user:{id:'bot'}},members:{
      fetchMe:vi.fn().mockResolvedValue({permissions:new PermissionsBitField([P.Administrator])}),
      fetch:vi.fn().mockRejectedValue({code:10007}),
    }};
    const permissions=new PermissionService({} as any);
    for(const action of ['BAN','GLOBAL_BAN','WARN']) await expect(permissions.target(guild,null,target,action)).resolves.toBeUndefined();
    for(const action of ['KICK','TIMEOUT','UNTIMEOUT']) await expect(permissions.target(guild,null,target,action)).rejects.toThrow('not a current member');
    guild.members.fetch.mockRejectedValue({code:50013});
    await expect(permissions.target(guild,null,target,'BAN')).rejects.toEqual({code:50013});
  });
  it('keeps the immutable user ID when a username lookup fails',async()=> {
    const service=new CaseService({} as any,{users:{fetch:vi.fn().mockRejectedValue(new Error('Unknown user'))}} as any);
    const data=await service.data({requestId:'request',member:{id:'staff',user:{tag:'Staff'}},guild:{id:'guild',name:'Guild'}} as any,target,'NOTE_ADD','Note');
    expect(data.userId).toBe(target);expect(data.username).toBeUndefined();
  });
});
