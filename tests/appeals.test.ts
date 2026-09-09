import { describe,it,expect,vi } from 'vitest';
import { ChannelType,PermissionFlagsBits as P,PermissionsBitField } from 'discord.js';
import { AppealService } from '../src/services/appealService.js';
import { GuildService } from '../src/services/guildService.js';

describe('appeal configuration and tickets',()=> {
  it('validates, stores and removes appeal staff roles',async()=> {
    const member={id:'staff'};
    const ctx:any={member,guild:{id:'guild',roles:{fetch:vi.fn().mockResolvedValue({id:'role'})},members:{fetchMe:vi.fn().mockResolvedValue({})}}};
    const db:any={guildConfig:{findUnique:vi.fn().mockResolvedValue(null),upsert:vi.fn()},appealRole:{findMany:vi.fn().mockResolvedValue([{roleId:'123456789012345678'}]),upsert:vi.fn(),deleteMany:vi.fn()},moderatorAction:{create:vi.fn()},$transaction:vi.fn(async fn=>fn(db))};
    const permissions:any={check:vi.fn()};
    const audit:any={deliver:vi.fn()};
    const service=new GuildService(db,{} as any,permissions,audit);
    await expect(service.appealRole(ctx,'add','<@&123456789012345678>')).resolves.toBe('Added appeal role: <@&123456789012345678>.');
    expect(db.appealRole.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({roleId:'123456789012345678'})}));
    await expect(service.appealRole(ctx,'list')).resolves.toContain('<@&123456789012345678>');
    await expect(service.appealRole(ctx,'remove','123456789012345678')).resolves.toBe('Removed appeal role: <@&123456789012345678>.');
    expect(db.appealRole.deleteMany).toHaveBeenCalledWith({where:{guildId:'guild',roleId:'123456789012345678'}});
  });

  it('creates appeal channels for the configured appeal role',async()=> {
    const caseRecord={id:42,userId:'123456789012345678',guildId:'guild',action:'GLOBAL_BAN',reason:'Ban evasion'};
    const db:any={
      moderationCase:{findUnique:vi.fn().mockResolvedValue(caseRecord)},
      banAppeal:{findUnique:vi.fn().mockResolvedValue(null),upsert:vi.fn()},
      guildConfig:{findUnique:vi.fn().mockResolvedValue({appealCategoryId:'category'})},
      appealRole:{findMany:vi.fn().mockResolvedValue([{roleId:'role-one'},{roleId:'role-two'}])},
    };
    const category={id:'category',type:ChannelType.GuildCategory,permissionsFor:vi.fn().mockReturnValue(new PermissionsBitField([P.ViewChannel,P.ManageChannels,P.SendMessages,P.EmbedLinks]))};
    const send=vi.fn();
    const create=vi.fn().mockResolvedValue({id:'appeal-channel',send});
    const guild:any={roles:{everyone:{id:'everyone'}},members:{fetchMe:vi.fn().mockResolvedValue({id:'bot'})},channels:{fetch:vi.fn().mockResolvedValue(category),create}};
    const interaction:any={
      customId:'appeal:submit:42',
      user:{id:'123456789012345678',username:'Subject'},
      client:{guilds:{fetch:vi.fn().mockResolvedValue(guild)}},
      fields:{getTextInputValue:vi.fn((key:string)=>({name:'Subject',discordid:'123456789012345678',banreason:'Ban evasion',unbanreason:'I understand now.'})[key])},
      reply:vi.fn(),
    };
    const service=new AppealService(db,{log:vi.fn()} as any);
    await service.submit(interaction);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({permissionOverwrites:expect.arrayContaining([
      expect.objectContaining({id:'everyone',deny:[P.ViewChannel]}),
      expect.objectContaining({id:'role-one',allow:expect.arrayContaining([P.ViewChannel,P.SendMessages,P.ReadMessageHistory])}),
      expect.objectContaining({id:'role-two',allow:expect.arrayContaining([P.ViewChannel,P.SendMessages,P.ReadMessageHistory])}),
      expect.objectContaining({id:'bot',allow:expect.arrayContaining([P.ManageChannels])}),
    ])}));
    expect(db.banAppeal.upsert).toHaveBeenCalled();
    expect(send).toHaveBeenCalled();
  });
});
