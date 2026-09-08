import { describe,it,expect,vi } from 'vitest';
import { RecordsService } from '../src/services/recordsService.js';
describe('record visibility',()=> {
  const ctx:any={guild:{id:'own'},member:{id:'staff'}};
  function fixture() {
    const db:any={guildConfig:{findUnique:vi.fn().mockResolvedValue({shareNotes:true}),findMany:vi.fn().mockResolvedValue([{guildId:'shared'}])},enforcementGuild:{findFirst:vi.fn().mockResolvedValue({}),findMany:vi.fn().mockResolvedValue([{guildId:'shared'}])},userNote:{findFirst:vi.fn().mockResolvedValue(null)},moderationCase:{findFirst:vi.fn().mockResolvedValue(null)}};
    const service=new RecordsService(db,{} as any,{check:vi.fn()} as any,{} as any);
    return {db,service};
  }
  it('requires viewer opt-in and registration to see shared notes',async()=> {
    const f=fixture();expect(await f.service.noteGuilds(ctx)).toEqual(['own','shared']);
    f.db.guildConfig.findUnique.mockResolvedValue({shareNotes:false});expect(await f.service.noteGuilds(ctx)).toEqual(['own']);
    f.db.guildConfig.findUnique.mockResolvedValue({shareNotes:true});f.db.enforcementGuild.findFirst.mockResolvedValue(null);
    expect(await f.service.noteGuilds(ctx)).toEqual(['own']);
  });
  it('limits note modifications to their originating guild',async()=> {
    const f=fixture();await expect(f.service.note(ctx,'remove',42)).rejects.toThrow('originating server');
    expect(f.db.userNote.findFirst).toHaveBeenCalledWith({where:{id:42,guildId:'own',deletedAt:null}});
  });
  it('scopes history to local and global actions without a case interface',async()=> {
    const f=fixture();expect(f.service.scope(ctx)).toEqual({OR:[{guildId:'own'},{scope:'GLOBAL'}]});
    expect('getCase' in f.service).toBe(false);
  });
});
