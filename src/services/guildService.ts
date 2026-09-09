import { ChannelType, PermissionFlagsBits as P, type Client } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import type { PermissionService } from './permissionService.js';
import type { AuditService } from './auditService.js';
import { httpUrl, id, UserError } from '../utils/core.js';
export class GuildService {
  constructor(private db: Database, private client: Client, private permissions: PermissionService, private audit: AuditService) {}
  async configure(ctx: Context, key: string, value: string) {
    await this.permissions.check(ctx, 'admin');
    const keys: Record<string,string> = { logchannel:'logChannelId', globalchannel:'globalCommandChannelId', appealcategory:'appealCategoryId', appealurl:'appealUrl' };
    if (!keys[key]) throw new UserError('Unknown configuration key.');
    const parsed = value === 'none' ? null : key === 'appealurl' ? httpUrl(value,'Appeal URL') : id(value);
    if (parsed) {
      const me = await ctx.guild.members.fetchMe();
      if (key === 'appealurl') {
        // Link buttons do not need Discord channel permissions.
      } else if (key === 'appealcategory') {
        const channel = await ctx.guild.channels.fetch(parsed);
        if (channel?.type !== ChannelType.GuildCategory) throw new UserError('Choose a category ID for appeals.');
        if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels])) throw new UserError('The bot needs View Channel and Manage Channels in that appeal category.');
      } else {
        const channel = await ctx.guild.channels.fetch(parsed);
        if (!channel?.isTextBased() || !('send' in channel)) throw new UserError('Choose a sendable text channel in this server.');
        if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) throw new UserError('The bot needs View Channel, Send Messages and Embed Links in that channel.');
      }
    }
    const before = await this.db.guildConfig.findUnique({ where: { guildId: ctx.guild.id } });
    await this.db.$transaction(async tx => {
      await tx.guildConfig.upsert({ where: { guildId: ctx.guild.id }, create: { guildId: ctx.guild.id, [keys[key]]: parsed }, update: { [keys[key]]: parsed } });
      await tx.moderatorAction.create({ data: { guildId: ctx.guild.id, actorId: ctx.member.id, action: 'CONFIG', details: { key, old: before ? String(before[keys[key] as keyof typeof before]) : null, value: parsed } } });
    });
    await this.audit.deliver(ctx.guild.id, 'CONFIGURATION', `${ctx.member.id} changed ${key} to ${value}.`);
    return `Updated ${key}: ${value}.`;
  }
  async appealRole(ctx: Context, action: string, value?: string) {
    await this.permissions.check(ctx, 'admin');
    const normalized = action.toLowerCase();
    if (normalized === 'list') {
      const roles = await this.db.appealRole.findMany({ where: { guildId: ctx.guild.id }, orderBy: { id: 'asc' } });
      return roles.length ? `Appeal roles:\n${roles.map(r=>`<@&${r.roleId}>`).join('\n')}` : 'No appeal roles are configured.';
    }
    if (!['add','remove'].includes(normalized)) throw new UserError('Use add, remove or list for appealrole.');
    const roleId = id(value);
    const role = await ctx.guild.roles.fetch(roleId);
    if (!role) throw new UserError('Choose a role mention or role ID from this server.');
    if (normalized === 'add') {
      await this.db.appealRole.upsert({
        where: { guildId_roleId: { guildId: ctx.guild.id, roleId } },
        create: { guildId: ctx.guild.id, roleId, addedBy: ctx.member.id },
        update: {},
      });
      await this.audit.deliver(ctx.guild.id, 'CONFIGURATION', `${ctx.member.id} added appeal role ${roleId}.`);
      return `Added appeal role: <@&${roleId}>.`;
    }
    await this.db.appealRole.deleteMany({ where: { guildId: ctx.guild.id, roleId } });
    await this.audit.deliver(ctx.guild.id, 'CONFIGURATION', `${ctx.member.id} removed appeal role ${roleId}.`);
    return `Removed appeal role: <@&${roleId}>.`;
  }
}
