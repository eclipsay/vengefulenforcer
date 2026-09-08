import { PermissionFlagsBits as P, type Client } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import type { PermissionService } from './permissionService.js';
import type { AuditService } from './auditService.js';
import { id, required, UserError } from '../utils/core.js';
export class GuildService {
  constructor(private db: Database, private client: Client, private permissions: PermissionService, private audit: AuditService) {}
  async configure(ctx: Context, key: string, value: string) {
    await this.permissions.check(ctx, 'admin');
    const keys: Record<string,string> = { logchannel:'logChannelId', modrole:'moderatorRoleId', adminrole:'adminRoleId', notes:'shareNotes', globalbans:'globalBans', autoenforce:'autoEnforce' };
    if (!keys[key]) throw new UserError('Unknown configuration key.');
    let parsed: boolean | string | null;
    if (['notes','globalbans','autoenforce'].includes(key)) {
      if (!['on','off'].includes(value)) throw new UserError('Use on or off.');
      parsed = value === 'on';
    } else if (value === 'none') parsed = null;
    else {
      parsed = id(value);
      if (key === 'logchannel') {
        const channel = await ctx.guild.channels.fetch(parsed);
        if (!channel?.isTextBased() || !('send' in channel)) throw new UserError('Choose a sendable text channel in this server.');
        const me = await ctx.guild.members.fetchMe();
        if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) throw new UserError('The bot needs View Channel, Send Messages and Embed Links in the log channel.');
      } else if (!await ctx.guild.roles.fetch(parsed) || parsed === ctx.guild.id) throw new UserError('Choose a server role other than @everyone.');
    }
    const before = await this.db.guildConfig.findUnique({ where: { guildId: ctx.guild.id } });
    await this.db.$transaction(async tx => {
      await tx.guildConfig.upsert({ where: { guildId: ctx.guild.id }, create: { guildId: ctx.guild.id, [keys[key]]: parsed }, update: { [keys[key]]: parsed } });
      await tx.moderatorAction.create({ data: { guildId: ctx.guild.id, actorId: ctx.member.id, action: 'CONFIG', details: { key, old: before ? String(before[keys[key] as keyof typeof before]) : null, value: parsed } } });
    });
    await this.audit.deliver(ctx.guild.id, 'CONFIGURATION', `${ctx.member.id} changed ${key} to ${value}.`);
    return `Updated ${key}: ${value}.`;
  }
  async enforcement(ctx: Context, action: string, guildId: string) {
    await this.permissions.check(ctx, 'network');
    const existing = await this.db.enforcementGuild.findUnique({ where: { guildId } });
    let name = existing?.name;
    if (action === 'add' || action === 'enable') {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) throw new UserError('The bot must currently be in that guild before it can be registered or enabled.');
      await guild.fetch(); name = guild.name;
    }
    if (action !== 'add' && (!existing || existing.removedAt)) throw new UserError('That guild is not registered.');
    await this.db.$transaction(async tx => {
      if (action === 'add') {
        await tx.enforcementGuild.upsert({ where: { guildId }, create: { guildId, name: name!, registeredBy: ctx.member.id },
          update: { name, active: true, enabled: true, removedAt: null, registeredBy: ctx.member.id, registeredAt: new Date() } });
        await tx.guildConfig.upsert({ where: { guildId }, create: { guildId }, update: {} });
      } else await tx.enforcementGuild.update({ where: { guildId }, data: action === 'remove' ? { removedAt: new Date(), enabled: false } : { enabled: action === 'enable' } });
      await tx.moderatorAction.create({ data: { guildId: ctx.guild.id, actorId: ctx.member.id, action: `ENFORCEMENT_${action.toUpperCase()}`, details: { guildId, name } } });
    });
    await this.audit.deliver(ctx.guild.id, 'NETWORK CONTROL', `${action}: ${name} (${guildId}) by ${ctx.member.id}`);
    return action === 'add' ? 'Guild successfully added to the Vengeful Enforcer enforcement network. Run -sync bans to apply existing bans now.' : `Enforcement ${action}: ${guildId}.`;
  }
  async staff(ctx: Context, action: string, userId: string, role?: string) {
    await this.permissions.check(ctx, 'owner');
    if (action === 'add' && !['ADMIN','MODERATOR'].includes(role ?? '')) throw new UserError('Role must be ADMIN or MODERATOR.');
    await this.db.$transaction(async tx => {
      if (action === 'add') await tx.globalModerator.upsert({ where: { userId }, create: { userId, role: role!, grantedBy: ctx.member.id }, update: { role: role!, grantedBy: ctx.member.id } });
      else await tx.globalModerator.deleteMany({ where: { userId } });
      await tx.moderatorAction.create({ data: { guildId: ctx.guild.id, actorId: ctx.member.id, action: 'GLOBAL_PERMISSION_CHANGE', details: { action, userId, role: role ?? null } } });
    });
    await this.audit.deliver(ctx.guild.id, 'PERMISSIONS', `${action}: ${userId} ${role ?? ''}`);
    return `Global permission ${action}: ${userId}.`;
  }
  async protect(ctx: Context, action: string, userId: string, reason?: string) {
    await this.permissions.check(ctx, 'network');
    await this.db.$transaction(async tx => {
      if (action === 'add') await tx.protectedUser.upsert({ where: { userId }, create: { userId, reason: required(reason), addedBy: ctx.member.id }, update: { reason: required(reason), addedBy: ctx.member.id } });
      else await tx.protectedUser.deleteMany({ where: { userId } });
      await tx.moderatorAction.create({ data: { guildId: ctx.guild.id, actorId: ctx.member.id, action: 'PROTECTION_CHANGE', details: { action, userId, reason: reason ?? null } } });
    });
    await this.audit.deliver(ctx.guild.id, 'PROTECTED USERS', `${action}: ${userId}`);
    return `Protection ${action}: ${userId}. Existing bans are unchanged.`;
  }
}
