import { PermissionFlagsBits as P, type Client } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import type { PermissionService } from './permissionService.js';
import type { AuditService } from './auditService.js';
import { id, UserError } from '../utils/core.js';
export class GuildService {
  constructor(private db: Database, private client: Client, private permissions: PermissionService, private audit: AuditService) {}
  async configure(ctx: Context, key: string, value: string) {
    await this.permissions.check(ctx, 'admin');
    const keys: Record<string,string> = { logchannel:'logChannelId', globalchannel:'globalCommandChannelId' };
    if (!keys[key]) throw new UserError('Unknown configuration key.');
    const parsed = value === 'none' ? null : id(value);
    if (parsed) {
      const channel = await ctx.guild.channels.fetch(parsed);
      if (!channel?.isTextBased() || !('send' in channel)) throw new UserError('Choose a sendable text channel in this server.');
      const me = await ctx.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) throw new UserError('The bot needs View Channel, Send Messages and Embed Links in that channel.');
    }
    const before = await this.db.guildConfig.findUnique({ where: { guildId: ctx.guild.id } });
    await this.db.$transaction(async tx => {
      await tx.guildConfig.upsert({ where: { guildId: ctx.guild.id }, create: { guildId: ctx.guild.id, [keys[key]]: parsed }, update: { [keys[key]]: parsed } });
      await tx.moderatorAction.create({ data: { guildId: ctx.guild.id, actorId: ctx.member.id, action: 'CONFIG', details: { key, old: before ? String(before[keys[key] as keyof typeof before]) : null, value: parsed } } });
    });
    await this.audit.deliver(ctx.guild.id, 'CONFIGURATION', `${ctx.member.id} changed ${key} to ${value}.`);
    return `Updated ${key}: ${value}.`;
  }
}
