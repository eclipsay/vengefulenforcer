import { describe,it,expect,vi } from 'vitest';
import { NotificationService } from '../src/services/notificationService.js';
import { ModerationService } from '../src/services/moderationService.js';
const record={id:42,userId:'123456789012345678',action:'WARN',scope:'LOCAL',guildName:'Test Guild',reason:'Repeated spam',createdAt:new Date('2026-09-08T12:00:00Z')};
function notificationFixture(fail=false) {
  const send=fail ? vi.fn().mockRejectedValue(new Error('Cannot send messages to this user')) : vi.fn().mockResolvedValue({});
  const db={notification:{findUnique:vi.fn().mockResolvedValue(null),create:vi.fn().mockResolvedValue({id:1}),update:vi.fn().mockResolvedValue({})}};
  const client={users:{fetch:vi.fn().mockResolvedValue({send})}};
  return {db,client,send,service:new NotificationService(db as any,client as any)};
}
describe('warning and ban DMs',()=> {
  it('includes server, reason, case number and date',async()=> {
    const f=notificationFixture(); expect(await f.service.send(record as any)).toBe('SENT');
    const payload=f.send.mock.calls[0][0];
    expect(payload.embeds[0].toJSON().description).toContain('Repeated spam');
    expect(payload.embeds[0].toJSON().description).toContain('VE-000042');
    expect(payload.embeds[0].toJSON().description).toContain('Test Guild');
    expect(payload.allowedMentions).toEqual({parse:[]});
    expect(f.db.notification.update).toHaveBeenCalledWith(expect.objectContaining({data:{status:'SENT',error:undefined}}));
  });
  it('records closed-DM failure without throwing',async()=> {
    const f=notificationFixture(true); expect(await f.service.send(record as any)).toBe('FAILED');
    expect(f.db.notification.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'FAILED'})}));
  });
  it('does not repeat a notification after a restart or ambiguous send',async()=> {
    const f=notificationFixture();f.db.notification.findUnique.mockResolvedValue({status:'UNKNOWN'});
    expect(await f.service.send(record as any)).toBe('UNKNOWN');expect(f.send).not.toHaveBeenCalled();
  });
  it('does not falsely assert completed enforcement in pre-ban notices',async()=> {
    const f=notificationFixture();await f.service.send({...record,action:'GLOBAL_BAN',scope:'GLOBAL'} as any);
    expect(f.send.mock.calls[0][0].embeds[0].toJSON().description).toContain('Enforcement is about to be attempted');
  });
});
function moderationFixture(action:string,dm='SENT') {
  const order:string[]=[];
  const c={...record,action,status:'PENDING'};
  const db:any={moderationCase:{findUnique:vi.fn().mockResolvedValue(null),update:vi.fn(async({data}:any)=>{order.push(`status:${data.status}`);return {...c,...data};})}};
  db.$transaction=async(fn:any)=>{const value=await fn(db);order.push('commit');return value;};
  const permissions={check:vi.fn(),target:vi.fn()};
  const cases={data:vi.fn().mockResolvedValue({}),create:vi.fn().mockResolvedValue(c)};
  const notifications={send:vi.fn(async()=>{order.push('dm');return dm;})};
  const audit={log:vi.fn()};
  const ban=vi.fn(async()=>{order.push('ban');});
  const ctx:any={requestId:'request',guild:{id:'guild',members:{ban}},member:{id:'moderator'}};
  return {order,db,permissions,cases,notifications,audit,ban,ctx,service:new ModerationService(db,permissions as any,cases as any,notifications as any,audit as any)};
}
describe('moderation service durability',()=> {
  it('commits a successful warning before DM delivery',async()=> {
    const f=moderationFixture('WARN');await f.service.punish(f.ctx,'WARN',record.userId,'Repeated spam');
    expect(f.order).toEqual(['status:SUCCESS','commit','dm']);expect(f.audit.log).toHaveBeenCalled();
  });
  it('still bans with a blocked DM and sends before the ban',async()=> {
    const f=moderationFixture('BAN','FAILED');const result=await f.service.punish(f.ctx,'BAN',record.userId,'Repeated spam');
    expect(f.order).toEqual(['commit','dm','ban','status:SUCCESS']);expect(result).toContain('DM: FAILED');
  });
  it('records Discord failure without reporting successful punishment',async()=> {
    const f=moderationFixture('BAN');f.ban.mockRejectedValue(new Error('Missing permissions'));
    expect(await f.service.punish(f.ctx,'BAN',record.userId,'Spam')).toContain('action failed');
    expect(f.db.moderationCase.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'FAILED'})}));
  });
  it('denies unauthorized punishment before creating a case or DM',async()=> {
    const f=moderationFixture('WARN');f.permissions.check.mockRejectedValue(new Error('Denied'));
    await expect(f.service.punish(f.ctx,'WARN',record.userId,'Spam')).rejects.toThrow('Denied');
    expect(f.cases.create).not.toHaveBeenCalled();expect(f.notifications.send).not.toHaveBeenCalled();
  });
  it('deduplicates repeated Discord requests',async()=> {
    const f=moderationFixture('WARN');f.db.moderationCase.findUnique.mockResolvedValue({...record,status:'SUCCESS'});
    expect(await f.service.punish(f.ctx,'WARN',record.userId,'Spam')).toContain('already recorded');
    expect(f.cases.create).not.toHaveBeenCalled();expect(f.notifications.send).not.toHaveBeenCalled();
  });
});
