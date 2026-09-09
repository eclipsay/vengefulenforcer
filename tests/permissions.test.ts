import { describe,it,expect,vi } from 'vitest';
import { PermissionFlagsBits as P,PermissionsBitField } from 'discord.js';
import { PermissionService } from '../src/services/permissionService.js';
function fixture(bits:bigint[]=[],guildId='control') {
  const member={id:'staff',permissions:new PermissionsBitField(bits),roles:{cache:new Map()}};
  const db={guildConfig:{findUnique:vi.fn().mockResolvedValue(null)},globalModerator:{findUnique:vi.fn().mockResolvedValue(null)}};
  const ctx:any={member,channelId:'commands',guild:{id:guildId,members:{fetch:vi.fn().mockResolvedValue(member)}}};
  return {member,db,ctx,service:new PermissionService(db as any,'commands')};
}
describe('permission boundaries',()=> {
  it('permits Ban Members in the allowed channel in any guild',async()=> {
    const f=fixture([P.BanMembers],'faction');await expect(f.service.check(f.ctx,'global')).resolves.toBeUndefined();
    expect(f.db.globalModerator.findUnique).not.toHaveBeenCalled();
  });
  it('rejects the wrong channel even for administrators and threads',async()=> {
    const f=fixture([P.Administrator],'faction');f.ctx.channelId='thread';
    await expect(f.service.check(f.ctx,'global')).rejects.toThrow('Use global commands');
  });
  it('does not apply the global command channel lock to non-global commands',async()=> {
    const f=fixture([P.BanMembers,P.ModerateMembers],'faction');
    f.ctx.channelId='general';
    for (const permission of ['ban','moderator'] as const) await expect(f.service.check(f.ctx,permission)).resolves.toBeUndefined();
  });
  it('does not grant permissions from legacy moderator roles',async()=> {
    const f=fixture();f.db.guildConfig.findUnique.mockResolvedValue({moderatorRoleId:'role'});f.member.roles.cache.set('role',{});
    await expect(f.service.check(f.ctx,'moderator')).rejects.toThrow();
    await expect(f.service.check(f.ctx,'global')).rejects.toThrow('Ban Members');
  });
  it('requires an explicitly configured channel and supports guild configuration',async()=> {
    const f=fixture([P.BanMembers]);const service=new PermissionService(f.db as any);
    await expect(service.check(f.ctx,'global')).rejects.toThrow('globalchannel');
    f.db.guildConfig.findUnique.mockResolvedValue({globalCommandChannelId:'commands'});
    await expect(service.check(f.ctx,'global')).resolves.toBeUndefined();
    await expect(service.check(f.ctx,'admin')).rejects.toThrow();
  });
  it('rechecks live permissions after a staff permission is revoked',async()=> {
    const f=fixture([P.BanMembers]);
    await f.service.check(f.ctx,'global');
    f.member.permissions.remove(P.BanMembers);
    await expect(f.service.check(f.ctx,'global')).rejects.toThrow('Ban Members');
  });
  it('rejects an equal-role target',async()=> {
    const f=fixture();const actor:any={id:'staff',roles:{highest:{comparePositionTo:()=>0}}};
    const guild:any={ownerId:'owner',client:{user:{id:'bot'}},members:{fetchMe:async()=>({permissions:new PermissionsBitField([P.BanMembers]),roles:{highest:{comparePositionTo:()=>1}}}),fetch:async()=>({roles:{highest:{}}})}};
    await expect(f.service.target(guild,actor,'target','BAN')).rejects.toThrow('equal or higher');
  });
});
