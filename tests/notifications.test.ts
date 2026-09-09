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
  it('includes server, reason and date without case numbers',async()=> {
    const f=notificationFixture(); expect(await f.service.send(record as any)).toBe('SENT');
    const payload=f.send.mock.calls[0][0];
    expect(payload.embeds[0].toJSON().description).toContain('Repeated spam');
    expect(payload.embeds[0].toJSON().description).toContain('<t:1788868800:F>');
    expect(payload.embeds[0].toJSON().description).not.toContain('VE-000042');
    expect(payload.embeds[0].toJSON().description).not.toContain('Case:');
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
  it('uses simple human wording in ban notices',async()=> {
    const f=notificationFixture();await f.service.send({...record,action:'GLOBAL_BAN',scope:'GLOBAL'} as any);
    const text=f.send.mock.calls[0][0].embeds[0].toJSON().description;
    expect(text).toContain('You have been banned from Vengeful Realms.');
    expect(text).toContain('If you believe this was a mistake');
    expect(text).not.toContain('Enforcement is about to be attempted');
    expect(text).not.toContain('issued against your account');
  });
  it('shows global temp ban expiration as a Discord timestamp',async()=> {
    const f=notificationFixture();await f.service.send({...record,action:'GLOBAL_TEMP_BAN',scope:'GLOBAL',expiresAt:new Date('2026-09-15T12:00:00Z')} as any);
    const text=f.send.mock.calls[0][0].embeds[0].toJSON().description;
    expect(text).toContain('Expires: <t:1789473600:F>');
    expect(text).not.toContain('2026-09-15T12:00:00.000Z');
  });
  it('adds an appeal button to ban notices',async()=> {
    const f=notificationFixture();await f.service.send({...record,action:'BAN',scope:'LOCAL'} as any);
    const payload=f.send.mock.calls[0][0];
    expect(payload.components[0].components[0].data.custom_id).toBe('appeal:start:42');
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
  const cleanup={safeDeleteUserMessages:vi.fn(async()=>({deleted:2,failed:0,channels:1,summary:'2 deleted'}))};
  const ban=vi.fn(async()=>{order.push('ban');});
  const ctx:any={requestId:'request',guild:{id:'guild',members:{ban}},member:{id:'moderator'}};
  return {order,db,permissions,cases,notifications,audit,cleanup,ban,ctx,service:new ModerationService(db,permissions as any,cases as any,notifications as any,audit as any,cleanup as any)};
}
describe('moderation service durability',()=> {
  it('commits a successful warning before DM delivery',async()=> {
    const f=moderationFixture('WARN');await f.service.punish(f.ctx,'WARN',record.userId,'Repeated spam');
    expect(f.order).toEqual(['status:SUCCESS','commit','dm']);expect(f.audit.log).toHaveBeenCalled();
  });
  it('still bans with a blocked DM and sends before the ban',async()=> {
    const f=moderationFixture('BAN','FAILED');const result=await f.service.punish(f.ctx,'BAN',record.userId,'Repeated spam');
    expect(f.order).toEqual(['commit','dm','ban','status:SUCCESS']);expect(result).toContain('DM: FAILED');
    expect(f.ban).toHaveBeenCalledWith(record.userId,expect.objectContaining({deleteMessageSeconds:604800}));
    expect(f.cleanup.safeDeleteUserMessages).toHaveBeenCalledWith(f.ctx.guild,record.userId);
  });
  it('records Discord failure without reporting successful punishment',async()=> {
    const f=moderationFixture('BAN');f.ban.mockRejectedValue(new Error('Missing permissions'));
    expect(await f.service.punish(f.ctx,'BAN',record.userId,'Spam')).toContain('Action failed');
    expect(f.db.moderationCase.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'FAILED'})}));
  });
  it('denies unauthorized punishment before creating a case or DM',async()=> {
    const f=moderationFixture('WARN');f.permissions.check.mockRejectedValue(new Error('Denied'));
    await expect(f.service.punish(f.ctx,'WARN',record.userId,'Spam')).rejects.toThrow('Denied');
    expect(f.cases.create).not.toHaveBeenCalled();expect(f.notifications.send).not.toHaveBeenCalled();
  });
  it('deduplicates repeated Discord requests',async()=> {
    const f=moderationFixture('WARN');f.db.moderationCase.findUnique.mockResolvedValue({...record,status:'SUCCESS'});
    expect(await f.service.punish(f.ctx,'WARN',record.userId,'Spam')).toContain('already processed');
    expect(f.cases.create).not.toHaveBeenCalled();expect(f.notifications.send).not.toHaveBeenCalled();
  });
});
