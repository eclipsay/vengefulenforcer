import { PermissionFlagsBits as P, type Guild, type GuildMember } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import { UserError } from '../utils/core.js';

export type Permission = 'public' | 'moderator' | 'ban' | 'kick' | 'timeout' | 'messages' | 'channel' | 'admin' | 'global';
export class PermissionService {
  constructor(private db: Database, private globalChannelId?: string) {}
  async commandChannel(guildId: string) {
    return this.globalChannelId ?? (await this.db.guildConfig.findUnique({ where: { guildId } }))?.globalCommandChannelId;
  }
  async check(ctx: Context, permission: Permission) {
    if (permission === 'public') return;
    const member = await ctx.guild.members.fetch({ user: ctx.member.id, force: true });
    ctx.member = member;
    const cfg = await this.db.guildConfig.findUnique({ where: { guildId: ctx.guild.id } });
    const admin = member.permissions.has(P.Administrator);
    if (permission === 'global') {
      if (!member.permissions.has(P.BanMembers)) throw new UserError('You need Discord Ban Members permission.');
      const channelId = this.globalChannelId ?? cfg?.globalCommandChannelId;
      if (!channelId) throw new UserError('An administrator must first run -config globalchannel #channel.');
      if (ctx.channelId !== channelId) throw new UserError(`Use global commands in <#${channelId}>.`);
      return;
    }
    if (permission === 'admin' && admin) return;
    const bits = { moderator: P.ModerateMembers, ban: P.BanMembers, kick: P.KickMembers,
      timeout: P.ModerateMembers, messages: P.ManageMessages, channel: P.ManageChannels };
    if (permission !== 'admin' && (admin || member.permissions.has(bits[permission as keyof typeof bits]) ||
      (permission === 'moderator' && member.permissions.has(P.BanMembers)))) return;
    throw new UserError(`You do not have the required ${permission} permission.`);
  }
  async target(guild: Guild, actor: GuildMember | null, userId: string, action: string) {
    if (userId === guild.ownerId || userId === guild.client.user.id || userId === actor?.id) {
      throw new UserError('You cannot punish the server owner, this bot, or yourself.');
    }
    const me = await guild.members.fetchMe();
    const permission = action.includes('BAN') ? P.BanMembers : action === 'KICK' ? P.KickMembers : action.includes('TIMEOUT') ? P.ModerateMembers : null;
    if (permission && !me.permissions.has(permission)) throw new UserError('The bot lacks the required Discord permission.');
    let target: GuildMember;
    try { target = await guild.members.fetch({ user: userId, force: true }); }
    catch (e) {
      if ((e as {code?: number}).code === 10007) {
        if (['BAN','GLOBAL_BAN','GLOBAL_TEMP_BAN','WARN'].includes(action)) return;
        throw new UserError('That user ID is not a current member of this server. Kicks and timeouts require the user to be in the server.');
      }
      throw e;
    }
    if (actor && actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new UserError('The target has an equal or higher role than you.');
    }
    if (action !== 'WARN' && me.roles.highest.comparePositionTo(target.roles.highest) <= 0) throw new UserError('Move the bot role above the target role.');
    if (action.includes('TIMEOUT') && (target.user.bot || target.permissions.has(P.Administrator))) throw new UserError('Bots and administrators cannot be timed out.');
  }
}
