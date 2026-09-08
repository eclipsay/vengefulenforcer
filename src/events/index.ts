import { AuditLogEvent, Events, type Client, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';
import type { Logger } from 'pino';
import type { Services } from '../services/index.js';
import { parsePrefix } from '../commands/prefix/parser.js';
import { parseSlash } from '../commands/slash/parser.js';
import { createRegistry } from '../commands/registry.js';
import { embed, UserError } from '../utils/core.js';

export function attachEvents(client: Client, s: Services, logger: Logger, prefix: string) {
  const execute = createRegistry(s,prefix);
  let accepting = false;
  const cooldowns = new Map<string,number>();
  const cooldown = (guildId:string,userId:string) => {
    const key=`${guildId}:${userId}`, now=Date.now();
    if ((cooldowns.get(key)??0)>now) throw new UserError('Please wait 2 seconds between commands.');
    cooldowns.set(key,now+2000);
    if (cooldowns.size>10000) for (const [key,expires] of cooldowns) if (expires<now) cooldowns.delete(key);
  };
  const safe = (work:()=>Promise<unknown>) => { void work().catch(err=>logger.error({err},'Event failed')); };
  client.on(Events.MessageCreate,message=> {
    if (message.author.bot || !message.guild || !message.content.startsWith(prefix)) return;
    safe(async()=> {
      try {
        if (!accepting) throw new UserError('The bot is recovering or shutting down. Try again shortly.');
        const invocation=parsePrefix(message.content,prefix);
        if (!invocation) return;
        cooldown(message.guild!.id,message.author.id);
        const member=await message.guild!.members.fetch(message.author.id);
        await s.queue.run(()=>execute({ guild:message.guild!,member,channelId:message.channelId,requestId:message.id,
          reply:payload=>message.reply({ ...payload,allowedMentions:{ parse:[],repliedUser:false } }) },invocation));
      } catch (err) {
        if (!(err instanceof UserError)) logger.error({err},'Prefix command failed');
        await message.reply({ embeds:[embed('ERROR',err instanceof UserError ? err.message : 'The operation was interrupted. Check history before retrying.')],allowedMentions:{ parse:[],repliedUser:false } });
      }
    });
  });
  client.on(Events.InteractionCreate,interaction=> {
    // Message component collectors own confirmation and pagination interactions.
    if (!interaction.isChatInputCommand()) return;
    safe(async()=> {
      try {
        await interaction.deferReply({ flags:64 });
        if (!accepting) throw new UserError('The bot is recovering or shutting down. Try again shortly.');
        if (!interaction.guild) throw new UserError('Use this command in a server.');
        const invocation=parseSlash(interaction);
        if (!invocation) throw new UserError('Commands need to be registered again.');
        cooldown(interaction.guild.id,interaction.user.id);
        const member=await interaction.guild.members.fetch(interaction.user.id);
        const reply = (payload:MessageCreateOptions) => interaction.editReply({ ...payload,allowedMentions:{parse:[]} } as MessageEditOptions);
        await s.queue.run(()=>execute({ guild:interaction.guild!,member,channelId:interaction.channelId,requestId:interaction.id,reply },invocation));
      } catch (err) {
        if (!(err instanceof UserError)) logger.error({err},'Slash command failed');
        const payload={ embeds:[embed('ERROR',err instanceof UserError ? err.message : 'The operation was interrupted. Check history before retrying.')],components:[] };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload,flags:64 });
      }
    });
  });
  client.on(Events.GuildMemberAdd,member=>safe(()=>s.queue.run(()=>s.global.onSubject(member.guild.id,member.id,'JOIN'))));
  client.on(Events.GuildBanRemove,ban=>safe(()=>s.queue.run(async()=> {
    let actorId:string|undefined;
    try {
      const logs=await ban.guild.fetchAuditLogs({ type:AuditLogEvent.MemberBanRemove,limit:5 });
      actorId=logs.entries.find(e=>e.targetId===ban.user.id && Date.now()-e.createdTimestamp<30000)?.executorId ?? undefined;
    } catch { /* View Audit Log is optional; never infer an actor without evidence. */ }
    await s.audit.log(ban.guild.id,actorId??client.user!.id,'DISCORD_BAN_REMOVED',{ observed:true,actorKnown:!!actorId },ban.user.id);
    await s.global.onSubject(ban.guild.id,ban.user.id,'MANUAL_UNBAN',actorId);
  })));
  client.on(Events.GuildBanAdd,ban=>safe(()=>s.queue.run(()=>s.audit.log(ban.guild.id,client.user!.id,'DISCORD_BAN_OBSERVED',{ observed:true },ban.user.id))));
  client.on(Events.GuildCreate,guild=>safe(()=>s.queue.run(async()=> {
    await s.db.guildConfig.upsert({ where:{ guildId:guild.id },create:{ guildId:guild.id },update:{} });
    // Re-invitation requires an explicit enable, preserving registry history.
    await s.db.enforcementGuild.updateMany({ where:{ guildId:guild.id },data:{ active:true,enabled:false,name:guild.name } });
    try { const owner=await guild.fetchOwner(); await owner.send('Vengeful Enforcer has been installed, but this Discord has not been registered/enabled with the enforcement network. A Main Server administrator must use -enforcement add <guild_id> or -enforcement enable <guild_id>.'); }
    catch (err) { logger.warn({err,guildId:guild.id},'Owner notification failed'); }
  })));
  client.on(Events.GuildDelete,guild=>safe(()=>s.queue.run(async()=> {
    await s.db.enforcementGuild.updateMany({ where:{ guildId:guild.id },data:{ active:false,enabled:false } });
    await s.audit.log(guild.id,client.user!.id,'GUILD_LEFT',{ guildId:guild.id });
  })));
  client.on(Events.Error,err=>logger.error({err},'Discord client error'));
  client.on(Events.Warn,warning=>logger.warn({warning},'Discord warning'));
  return { start:()=>{ accepting=true; },stop:()=>{ accepting=false; } };
}
