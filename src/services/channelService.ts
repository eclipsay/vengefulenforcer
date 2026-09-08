import { PermissionFlagsBits as P, ChannelType } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import type { PermissionService } from './permissionService.js';
import type { AuditService } from './auditService.js';
import { UserError, errorText } from '../utils/core.js';
export class ChannelService {
  constructor(private db: Database, private permissions: PermissionService, private audit: AuditService) {}
  async run(ctx: Context, action: string, amount?: number) {
    await this.permissions.check(ctx, action === 'clear' ? 'messages' : 'channel');
    const channel = await ctx.guild.channels.fetch(ctx.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) throw new UserError('Use this command in a standard server text channel.');
    const me = await ctx.guild.members.fetchMe();
    if (!channel.permissionsFor(me).has(action === 'clear' ? [P.ManageMessages,P.ReadMessageHistory] : action === 'slowmode' ? P.ManageChannels : P.ManageRoles)) throw new UserError('The bot lacks the required channel permissions.');
    // Store intent before calling Discord so an interrupted action remains reviewable.
    const audit = await this.db.moderatorAction.create({ data: { guildId: ctx.guild.id, actorId: ctx.member.id, action: action.toUpperCase(), details: { channelId: channel.id, amount: amount ?? null, status: 'PENDING' } } });
    let result = '';
    try {
      if (action === 'clear') {
        const messages = await channel.messages.fetch({ limit: amount! });
        const deleted = await channel.bulkDelete(messages, true);
        result = `Deleted ${deleted.size} messages. Messages older than 14 days are skipped.`;
      } else if (action === 'slowmode') {
        await channel.setRateLimitPerUser(amount!, `Moderator ${ctx.member.id}`); result = `Slowmode set to ${amount} seconds.`;
      } else if (action === 'lock') {
        const old = await this.db.channelLock.findUnique({ where: { channelId: channel.id } });
        if (old?.active) throw new UserError('This channel is already locked by the bot.');
        const overwrite = channel.permissionOverwrites.cache.get(ctx.guild.id);
        const previous = overwrite?.allow.has(P.SendMessages) ? 'ALLOW' : overwrite?.deny.has(P.SendMessages) ? 'DENY' : 'INHERIT';
        await this.db.channelLock.upsert({ where: { channelId: channel.id }, create: { channelId: channel.id, guildId: ctx.guild.id, previous }, update: { previous, active: true } });
        await channel.permissionOverwrites.edit(ctx.guild.id, { SendMessages: false });
        result = 'Channel locked for @everyone. Explicit role/member allows and administrators can still send.';
      } else {
        const old = await this.db.channelLock.findUnique({ where: { channelId: channel.id } });
        if (!old?.active) throw new UserError('No saved bot lock exists for this channel.');
        await channel.permissionOverwrites.edit(ctx.guild.id, { SendMessages: old.previous === 'INHERIT' ? null : old.previous === 'ALLOW' });
        await this.db.channelLock.update({ where: { channelId: channel.id }, data: { active: false } });
        result = 'Restored the previous @everyone Send Messages setting.';
      }
    } catch (err) {
      await this.db.moderatorAction.update({ where: { id: audit.id }, data: { details: { channelId: channel.id, status: 'FAILED', error: errorText(err) } } });
      throw err;
    }
    await this.db.moderatorAction.update({ where: { id: audit.id }, data: { details: { channelId: channel.id, status: 'SUCCESS', result } } });
    await this.audit.deliver(ctx.guild.id, action.toUpperCase(), `${ctx.member.id}: ${result}`);
    return result;
  }
}
