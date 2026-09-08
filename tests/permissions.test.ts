import { describe,it,expect,vi } from 'vitest';
import { PermissionFlagsBits as P,PermissionsBitField } from 'discord.js';
import { PermissionService } from '../src/services/permissionService.js';
function fixture(bits:bigint[]=[],guildId='control') {
  const member={id:'staff',permissions:new PermissionsBitField(bits),roles:{cache:new Map()}};
  const db={guildConfig:{findUnique:vi.fn().mockResolvedValue(null)},globalModerator:{findUnique:vi.fn().mockResolvedValue(null)}};
  const ctx:any={member,guild:{id:guildId,members:{fetch:vi.fn().mockResolvedValue(member)}}};
  return {member,db,ctx,service:new PermissionService(db as any,'control','owner')};
}
describe('permission boundaries',()=> {
  it('permits Control Server Ban Members for global bans',async()=> {
    const f=fixture([P.BanMembers]);await expect(f.service.check(f.ctx,'global')).resolves.toBeUndefined();
    await expect(f.service.check(f.ctx,'network')).rejects.toThrow();
  });
  it('rejects global operations outside Control even for administrators',async()=> {
    const f=fixture([P.Administrator],'faction');await expect(f.service.check(f.ctx,'global')).rejects.toThrow('Control');
    await expect(f.service.check(f.ctx,'network')).rejects.toThrow();
  });
  it('permits configured moderator roles without granting network administration',async()=> {
    const f=fixture();f.db.guildConfig.findUnique.mockResolvedValue({moderatorRoleId:'role'});f.member.roles.cache.set('role',{});
    await expect(f.service.check(f.ctx,'moderator')).resolves.toBeUndefined();
    await expect(f.service.check(f.ctx,'network')).rejects.toThrow();
  });
  it('requires owner for granting global staff permissions',async()=> {
    const f=fixture([P.Administrator]);await expect(f.service.check(f.ctx,'owner')).rejects.toThrow('BOT_OWNER_ID');
  });
  it('rejects an equal-role target',async()=> {
    const f=fixture();const actor:any={id:'staff',roles:{highest:{comparePositionTo:()=>0}}};
    const guild:any={ownerId:'owner',client:{user:{id:'bot'}},members:{fetchMe:async()=>({permissions:new PermissionsBitField([P.BanMembers]),roles:{highest:{comparePositionTo:()=>1}}}),fetch:async()=>({roles:{highest:{}}})}};
    await expect(f.service.target(guild,actor,'target','BAN')).rejects.toThrow('equal or higher');
  });
});
