import { describe,it,expect,vi } from 'vitest';
import { GlobalBanService } from '../src/services/globalBanService.js';
import { BanSyncService } from '../src/services/banSyncService.js';
function fixture() {
  const record={id:42,userId:'target',reason:'Spam',scope:'GLOBAL'};
  const db:any={
    enforcementGuild:{findUnique:vi.fn().mockResolvedValue({active:true,enabled:true,removedAt:null}),findMany:vi.fn().mockResolvedValue([{guildId:'one'},{guildId:'two'}])},
    guildConfig:{findUnique:vi.fn().mockResolvedValue({globalBans:true}),findMany:vi.fn().mockResolvedValue([])},
    globalBan:{findUnique:vi.fn().mockResolvedValue({active:true,caseId:42}),findFirst:vi.fn().mockResolvedValue({...record,case:record,caseId:42})},
    globalBanExecution:{create:vi.fn().mockResolvedValue({id:1}),update:vi.fn().mockResolvedValue({}),findMany:vi.fn().mockResolvedValue([{id:1,guildId:'one',action:'BAN',status:'PENDING'},{id:2,guildId:'two',action:'BAN',status:'PENDING'}])},
    moderationCase:{update:vi.fn().mockResolvedValue({})},
  };
  const ban=vi.fn().mockResolvedValue({});
  const client:any={user:{id:'bot'},guilds:{fetch:vi.fn().mockResolvedValue({bans:{fetch:vi.fn().mockRejectedValue({code:10026})},members:{ban,unban:vi.fn()}})}};
  const permissions:any={target:vi.fn()};const cases:any={create:vi.fn()};const notifications:any={send:vi.fn()};
  const audit:any={deliver:vi.fn(),log:vi.fn()};
  const service=new GlobalBanService(db,client,permissions,cases,notifications,audit);
  return {record,db,client,permissions,cases,notifications,audit,service,ban};
}
describe('global enforcement recovery',()=> {
  it('attempts later guilds when one Discord guild fails',async()=> {
    const f=fixture();f.client.guilds.fetch.mockRejectedValueOnce(new Error('Missing Access'));
    expect(await f.service.processPending(f.record as any)).toEqual({success:1,failed:1,skipped:0});
    expect(f.client.guilds.fetch).toHaveBeenCalledTimes(2);expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it('skips removed or disabled servers',async()=> {
    const f=fixture();f.db.enforcementGuild.findUnique.mockResolvedValue({active:true,enabled:false});
    expect(await f.service.execute(f.record as any,'guild','BAN','SYNC')).toBe('SKIPPED');
    expect(f.client.guilds.fetch).not.toHaveBeenCalled();
  });
  it('filters registry and guild opt-outs from the network',async()=> {
    const f=fixture();f.db.guildConfig.findMany.mockResolvedValue([{guildId:'one',globalBans:false}]);
    expect(await f.service.guilds()).toEqual([{guildId:'two'}]);
    expect(f.db.enforcementGuild.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{active:true,enabled:true,removedAt:null}}));
  });
  it('does not revive a revoked ban or unban a newer active ban',async()=> {
    const f=fixture();f.db.globalBan.findUnique.mockResolvedValue({active:false,caseId:42});
    expect(await f.service.execute(f.record as any,'guild','BAN','SYNC')).toBe('SKIPPED');
    f.db.globalBan.findUnique.mockResolvedValue({active:true,caseId:99});
    expect(await f.service.execute(f.record as any,'guild','UNBAN','RETRY')).toBe('SKIPPED');
  });
  it('does not send repeated DMs or create cases during synchronization',async()=> {
    const f=fixture();await f.service.execute(f.record as any,'guild','BAN','SYNC');
    expect(f.notifications.send).not.toHaveBeenCalled();expect(f.cases.create).not.toHaveBeenCalled();
  });
  it('warns without reapplying manual unbans when auto-enforcement is off',async()=> {
    const f=fixture();f.db.guildConfig.findUnique.mockResolvedValue({globalBans:true,autoEnforce:false});
    await f.service.onSubject('guild','target','MANUAL_UNBAN','actor');
    expect(f.audit.log).toHaveBeenCalled();expect(f.ban).not.toHaveBeenCalled();
  });
  it('recovers pending revocations and loads bans from the database',async()=> {
    const db:any={moderationCase:{findMany:vi.fn().mockResolvedValue([{id:100,action:'GLOBAL_UNBAN'}])},globalBan:{findMany:vi.fn().mockResolvedValueOnce([{userId:'target',case:{id:42}}]).mockResolvedValueOnce([])}};
    const global:any={processPending:vi.fn(),guilds:vi.fn().mockResolvedValue([{guildId:'guild'}]),execute:vi.fn().mockResolvedValue('ALREADY_ENFORCED')};
    const audit:any={log:vi.fn()};const service=new BanSyncService(db,global,audit,'control','bot');
    expect(await service.run()).toEqual({records:1,guilds:1,checks:1,already:1,reapplied:0,failed:0,skipped:0});
    expect(global.processPending).toHaveBeenCalledWith({id:100,action:'GLOBAL_UNBAN'});
  });
});
