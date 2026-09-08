import { PermissionFlagsBits as P, type Guild, type GuildMember } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import { UserError } from '../utils/core.js';

export type Permission = 'public' | 'moderator' | 'ban' | 'kick' | 'timeout' | 'messages' | 'channel' | 'admin' | 'global' | 'network' | 'owner';
export class PermissionService {
  constructor(private db: Database, private controlId: string, private ownerId: string) {}
  isOwner(userId: string) { return userId === this.ownerId; }
  async check(ctx: Context, permission: Permission) {
    if (permission === 'public') return;
    const member = await ctx.guild.members.fetch({ user: ctx.member.id, force: true });
    ctx.member = member;
    const cfg = await this.db.guildConfig.findUnique({ where: { guildId: ctx.guild.id } });
    const admin = member.permissions.has(P.Administrator) || !!(cfg?.adminRoleId && member.roles.cache.has(cfg.adminRoleId));
    const mod = admin || !!(cfg?.moderatorRoleId && member.roles.cache.has(cfg.moderatorRoleId));
    if (['network', 'owner', 'global'].includes(permission)) {
      if (ctx.guild.id !== this.controlId) throw new UserError('Global commands must be used in the Main / Control Server.');
      if (this.isOwner(member.id)) return;
      const global = await this.db.globalModerator.findUnique({ where: { userId: member.id } });
      if (permission === 'owner') throw new UserError('Only BOT_OWNER_ID may change global staff permissions.');
      if (admin || global?.role === 'ADMIN') return;
      if (permission === 'global' && (global?.role === 'MODERATOR' || member.permissions.has(P.BanMembers))) return;
      throw new UserError('Global administrative permission is required.');
    }
    if (permission === 'admin' && admin) return;
    const bits = { moderator: P.ModerateMembers, ban: P.BanMembers, kick: P.KickMembers,
      timeout: P.ModerateMembers, messages: P.ManageMessages, channel: P.ManageChannels };
    if (permission !== 'admin' && (mod || member.permissions.has(bits[permission as keyof typeof bits]) ||
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
    catch (e) { if ((e as {code?: number}).code === 10007 && ['BAN','GLOBAL_BAN','WARN'].includes(action)) return; throw e; }
    if (actor && actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new UserError('The target has an equal or higher role than you.');
    }
    if (action !== 'WARN' && me.roles.highest.comparePositionTo(target.roles.highest) <= 0) throw new UserError('Move the bot role above the target role.');
    if (action.includes('TIMEOUT') && (target.user.bot || target.permissions.has(P.Administrator))) throw new UserError('Bots and administrators cannot be timed out.');
  }
}
