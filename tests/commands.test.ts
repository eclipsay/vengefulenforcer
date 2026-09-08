import {describe,it,expect,vi} from 'vitest';
import {PermissionFlagsBits as P,PermissionsBitField} from 'discord.js';
import {createRegistry} from '../src/commands/registry.js';
import {parsePrefix} from '../src/commands/prefix/parser.js';
import {parseSlash} from '../src/commands/slash/parser.js';
import {PermissionService} from '../src/services/permissionService.js';

function fixture(channelId='commands',bits:bigint[]=[P.BanMembers]) {
  const member={id:'staff',permissions:new PermissionsBitField(bits)};
  const ctx:any={channelId,member,guild:{id:'any-server',members:{fetch:vi.fn().mockResolvedValue(member)}},reply:vi.fn().mockResolvedValue({})};
  const db:any={guildConfig:{findUnique:vi.fn().mockResolvedValue({globalCommandChannelId:'commands'})}};
  const global={globalBan:vi.fn().mockResolvedValue('Banned'),globalUnban:vi.fn().mockResolvedValue('Unbanned')};
  const services:any={db,permissions:new PermissionService(db),global};
  return {ctx,global,execute:createRegistry(services,'-')};
}
describe('simple global commands',()=> {
  it('executes a prefix global ban directly without confirmation',async()=> {
    const f=fixture();await f.execute(f.ctx,parsePrefix('-globalban 123456789012345678 Spam','-')!);
    expect(f.global.globalBan).toHaveBeenCalledWith(f.ctx,'123456789012345678','Spam',undefined);
    expect(f.ctx.reply).toHaveBeenCalledTimes(1);
    expect(f.ctx.reply.mock.calls[0][0].components).toBeUndefined();
  });
  it('routes slash global unban into the same service',async()=> {
    const f=fixture();
    const args:any={user:'123456789012345678',reason:'Appeal accepted'};
    const invocation=parseSlash({commandName:'globalunban',options:{getSubcommand:()=>null,getString:(name:string)=>args[name]}} as any)!;
    await f.execute(f.ctx,invocation);
    expect(f.global.globalUnban).toHaveBeenCalledWith(f.ctx,args.user,args.reason);
  });
  it('blocks both global actions in the wrong channel before side effects',async()=> {
    const f=fixture('wrong');
    for (const name of ['globalban','globalunban']) await expect(f.execute(f.ctx,parsePrefix('-'+name+' 123456789012345678 Reason','-')!)).rejects.toThrow('Use global commands');
    expect(f.global.globalBan).not.toHaveBeenCalled();expect(f.global.globalUnban).not.toHaveBeenCalled();
  });
  it('blocks both global actions without Ban Members',async()=> {
    const f=fixture('commands',[]);
    for (const name of ['globalban','globalunban']) await expect(f.execute(f.ctx,parsePrefix('-'+name+' 123456789012345678 Reason','-')!)).rejects.toThrow('Ban Members');
    expect(f.global.globalBan).not.toHaveBeenCalled();expect(f.global.globalUnban).not.toHaveBeenCalled();
  });
});
