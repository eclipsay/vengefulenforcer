import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import { errorText, retry, UserError } from '../utils/core.js';
import type { PermissionService, Permission } from './permissionService.js';
import type { CaseService } from './caseService.js';
import type { NotificationService } from './notificationService.js';
import type { AuditService } from './auditService.js';
import { BAN_DELETE_SECONDS, type MessageCleanupService } from './messageCleanupService.js';

export class ModerationService {
  constructor(private db: Database, private permissions: PermissionService, private cases: CaseService,
    private notifications: NotificationService, private audit: AuditService, private cleanup: MessageCleanupService) {}
  async punish(ctx: Context, action: string, userId: string, reason: string, seconds?: number) {
    const permission: Record<string, Permission> = { BAN: 'ban', UNBAN: 'ban', KICK: 'kick', TIMEOUT: 'timeout', UNTIMEOUT: 'timeout', WARN: 'moderator' };
    await this.permissions.check(ctx, permission[action]);
    const existing = await this.db.moderationCase.findUnique({ where: { requestId: ctx.requestId } });
    if (existing) return `This command was already processed: ${existing.status}.`;
    if (action === 'UNBAN') {
      if (await this.db.globalBan.findFirst({ where: { userId, active: true } })) throw new UserError('This user has an active global ban. Use globalunban in the configured global command channel.');
      const me = await ctx.guild.members.fetchMe();
      if (!me.permissions.has('BanMembers')) throw new UserError('The bot needs Ban Members.');
    } else await this.permissions.target(ctx.guild, ctx.member, userId, action);
    const data = await this.cases.data(ctx, userId, action, reason, 'LOCAL', seconds);
    const record = await this.db.$transaction(async tx => {
      const c = await this.cases.create(tx, data);
      return action === 'WARN' ? tx.moderationCase.update({ where: { id: c.id }, data: { status: 'SUCCESS' } }) : c;
    });
    // Warnings are already durable; bans are notified before removing shared-guild access.
    const dm = ['WARN','BAN'].includes(action) ? await this.notifications.send(record) : 'NOT_REQUESTED';
    if (action !== 'WARN') {
      const auditReason = `Vengeful Enforcer | ${ctx.member.id} | ${reason}`.slice(0, 512);
      try {
        if (action === 'BAN') await retry(() => ctx.guild.members.ban(userId, { reason: auditReason, deleteMessageSeconds: BAN_DELETE_SECONDS }));
        if (action === 'UNBAN') await retry(() => ctx.guild.members.unban(userId, auditReason));
        if (action === 'KICK') await ctx.guild.members.kick(userId, auditReason);
        if (action === 'TIMEOUT' || action === 'UNTIMEOUT') {
          const member = await ctx.guild.members.fetch(userId);
          await retry(() => member.timeout(action === 'TIMEOUT' ? seconds! * 1000 : null, auditReason));
        }
      } catch (err) {
        await this.db.moderationCase.update({ where: { id: record.id }, data: { status: 'FAILED', error: errorText(err) } });
        await this.audit.log(ctx.guild.id, ctx.member.id, `${action}_FAILED`, { recordId: record.id, error: errorText(err), dm }, userId);
        return `Action failed: ${errorText(err)}. DM: ${dm}.`;
      }
      await this.db.moderationCase.update({ where: { id: record.id }, data: { status: 'SUCCESS' } });
    }
    const cleanup = action === 'BAN' ? await this.cleanup.safeDeleteUserMessages(ctx.guild, userId) : undefined;
    await this.audit.log(ctx.guild.id, ctx.member.id, action, { recordId: record.id, reason, dm, cleanup }, userId);
    return `${action} recorded for ${userId}. DM: ${dm}${cleanup ? `. Messages cleaned from last 30 days: ${cleanup.summary}` : ''}${dm === 'FAILED' ? ' (the user may have DMs disabled; the action is still recorded)' : ''}.`;
  }
}
