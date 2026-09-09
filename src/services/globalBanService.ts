import type { Client } from 'discord.js';
import type { ModerationCase } from '@prisma/client';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import type { PermissionService } from './permissionService.js';
import type { CaseService } from './caseService.js';
import type { NotificationService } from './notificationService.js';
import type { AuditService } from './auditService.js';
import { BAN_DELETE_SECONDS, type MessageCleanupService } from './messageCleanupService.js';
import { discordMention, errorText, retry, UserError, userRef } from '../utils/core.js';

// Call mutations and reconciliation through the shared serial queue. A PostgreSQL
// session lock in index.ts guarantees there is only one active bot process.
export class GlobalBanService {
  constructor(private db: Database, private client: Client, private permissions: PermissionService,
    private cases: CaseService, private notifications: NotificationService, private audit: AuditService,
    private cleanup: MessageCleanupService) {}
  async guilds() {
    return [...this.client.guilds.cache.values()].map(g => ({ guildId: g.id, name: g.name }));
  }
  async validate(ctx: Context, userId: string) {
    await this.permissions.check(ctx, 'global');
    if (userId === ctx.member.id || userId === this.client.user?.id) throw new UserError('You cannot globally ban yourself or this bot.');
    await this.permissions.target(ctx.guild, ctx.member, userId, 'GLOBAL_BAN');
  }
  async globalBan(ctx: Context, userId: string, reason: string, evidence?: string) {
    await this.validate(ctx, userId);
    const duplicate = await this.db.moderationCase.findUnique({ where: { requestId: ctx.requestId } });
    if (duplicate) return 'This command has already been processed.';
    if (await this.db.globalBan.findFirst({ where: { userId, active: true } })) throw new UserError('This user is already globally banned. Missing bans are retried automatically.');
    const guilds = await this.guilds();
    const data = await this.cases.data(ctx, userId, 'GLOBAL_BAN', reason, 'GLOBAL');
    const record = await this.db.$transaction(async tx => {
      const c = await this.cases.create(tx, data, evidence);
      await tx.globalBan.upsert({ where: { userId }, create: { userId, caseId: c.id, reason, moderatorId: ctx.member.id },
        update: { caseId: c.id, reason, moderatorId: ctx.member.id, active: true, expiresAt: null, revokedAt: null, createdAt: new Date() } });
      await tx.globalBanExecution.createMany({ data: guilds.map(g => ({ caseId: c.id, guildId: g.guildId, action: 'BAN', source: 'COMMAND' })) });
      return c;
    });
    const dm = await this.notifications.send(record);
    const results = await this.processPending(record);
    await this.audit.log(ctx.guild.id, ctx.member.id, 'GLOBAL_BAN', { recordId: record.id, reason, dm, ...results }, userId);
    return `Global ban saved for ${userId}. ${results.success} servers banned, ${results.failed} failed, ${results.skipped} skipped. DM: ${dm}. Failed bans are retried automatically.`;
  }
  async globalTempBan(ctx: Context, userId: string, seconds: number, reason: string, evidence?: string) {
    await this.validate(ctx, userId);
    const duplicate = await this.db.moderationCase.findUnique({ where: { requestId: ctx.requestId } });
    if (duplicate) return 'This command has already been processed.';
    if (await this.db.globalBan.findFirst({ where: { userId, active: true } })) throw new UserError('This user is already globally banned. Missing bans are retried automatically.');
    const guilds = await this.guilds();
    const expiresAt = new Date(Date.now() + seconds * 1000);
    const data = await this.cases.data(ctx, userId, 'GLOBAL_TEMP_BAN', reason, 'GLOBAL', seconds);
    const record = await this.db.$transaction(async tx => {
      const c = await this.cases.create(tx, { ...data, expiresAt }, evidence);
      await tx.globalBan.upsert({ where: { userId }, create: { userId, caseId: c.id, reason, moderatorId: ctx.member.id, expiresAt },
        update: { caseId: c.id, reason, moderatorId: ctx.member.id, active: true, expiresAt, revokedAt: null, createdAt: new Date() } });
      await tx.globalBanExecution.createMany({ data: guilds.map(g => ({ caseId: c.id, guildId: g.guildId, action: 'BAN', source: 'COMMAND' })) });
      return c;
    });
    const dm = await this.notifications.send(record);
    const results = await this.processPending(record);
    await this.audit.log(ctx.guild.id, ctx.member.id, 'GLOBAL_TEMP_BAN', { recordId: record.id, reason, expiresAt: expiresAt.toISOString(), dm, ...results }, userId);
    return `Global temp ban saved for ${userId} until ${expiresAt.toISOString()}. ${results.success} servers banned, ${results.failed} failed, ${results.skipped} skipped. DM: ${dm}.`;
  }
  async globalUnban(ctx: Context, userId: string, reason: string) {
    await this.permissions.check(ctx, 'global');
    const duplicate = await this.db.moderationCase.findUnique({ where: { requestId: ctx.requestId } });
    if (duplicate) return 'This command has already been processed.';
    const active = await this.db.globalBan.findFirst({ where: { userId, active: true } });
    if (!active) throw new UserError('There is no active global ban for this ID.');
    const guilds = await this.guilds();
    const data = await this.cases.data(ctx, userId, 'GLOBAL_UNBAN', reason, 'GLOBAL');
    const record = await this.db.$transaction(async tx => {
      const c = await this.cases.create(tx, data);
      await tx.globalBan.update({ where: { userId }, data: { active: false, revokedAt: new Date() } });
      await tx.globalBanExecution.createMany({ data: guilds.map(g => ({ caseId: c.id, guildId: g.guildId, action: 'UNBAN', source: 'COMMAND' })) });
      return c;
    });
    const results = await this.processPending(record);
    await this.audit.log(ctx.guild.id, ctx.member.id, 'GLOBAL_UNBAN', { recordId: record.id, reason, ...results }, userId);
    return `Global ban removed for ${userId}. ${results.success} servers unbanned, ${results.failed} failed, ${results.skipped} skipped.`;
  }
  async execute(record: ModerationCase, guildId: string, action: string, source: string, executionId?: number): Promise<string> {
    const execution = executionId ? { id: executionId } : await this.db.globalBanExecution.create({ data: { caseId: record.id, guildId, action, source } });
    let status = 'SUCCESS'; let error: string | undefined;
    try {
      const active = await this.db.globalBan.findUnique({ where: { userId: record.userId } });
      if (!this.client.guilds.cache.has(guildId) ||
        (action === 'BAN' && (!active?.active || active.caseId !== record.id)) || (action === 'UNBAN' && active?.active)) {
        status = 'SKIPPED';
      } else {
        const guild = await this.client.guilds.fetch(guildId);
        const reason = `Vengeful Enforcer | ${record.reason}`.slice(0, 512);
        if (action === 'BAN') {
          let banned = false;
          try { await retry(() => guild.bans.fetch(record.userId)); banned = true; }
          catch (e) { if ((e as {code?: number}).code !== 10026) throw e; }
          if (banned) status = 'ALREADY_ENFORCED';
          else {
            await this.permissions.target(guild, null, record.userId, 'GLOBAL_BAN');
            await retry(() => guild.members.ban(record.userId, { reason, deleteMessageSeconds: BAN_DELETE_SECONDS }));
            const cleanup = await this.cleanup.safeDeleteUserMessages(guild, record.userId);
            if (cleanup.failed) error = cleanup.summary;
          }
        } else {
          try { await retry(() => guild.members.unban(record.userId, reason)); }
          catch (e) { if ((e as {code?: number}).code !== 10026) throw e; }
        }
      }
    } catch (err) { status = 'FAILED'; error = errorText(err); }
    await this.db.globalBanExecution.update({ where: { id: execution.id }, data: { status, error } });
    if (status !== 'ALREADY_ENFORCED') await this.audit.deliver(guildId, `GLOBAL ${action} ${status}`, `User: ${userRef(record.userId)}\n${error ?? record.reason}`);
    return status;
  }
  async processPending(record: ModerationCase) {
    // A crash after the case transaction but before notification still gets one
    // pre-enforcement notice. Existing SENT/FAILED/UNKNOWN records are not resent.
    if (record.action === 'GLOBAL_BAN' || record.action === 'GLOBAL_TEMP_BAN') await this.notifications.send(record);
    const jobs = await this.db.globalBanExecution.findMany({ where: { caseId: record.id, status: { in: ['PENDING','FAILED'] } } });
    const results = { success: 0, failed: 0, skipped: 0 };
    // Sequential REST work bounds concurrency; discord.js manages Discord buckets.
    for (const job of jobs) {
      // Keep every previous failure intact; each retry gets a separate durable row.
      const executionId = job.status === 'FAILED' ? await this.db.$transaction(async tx => {
        const next = await tx.globalBanExecution.create({ data: { caseId: job.caseId, guildId: job.guildId, action: job.action, source: 'RETRY' } });
        await tx.globalBanExecution.update({ where: { id: job.id }, data: { status: 'RETRIED' } });
        return next.id;
      }) : job.id;
      const status = await this.execute(record, job.guildId, job.action, job.source, executionId);
      if (status === 'FAILED') results.failed++;
      else if (status === 'SKIPPED') results.skipped++;
      else results.success++;
    }
    await this.db.moderationCase.update({ where: { id: record.id }, data: { status: results.failed ? 'PARTIAL' : 'SUCCESS' } });
    return results;
  }
  async onSubject(guildId: string, userId: string, source: 'JOIN' | 'MANUAL_UNBAN', actorId?: string) {
    if (!this.client.guilds.cache.has(guildId)) return;
    const ban = await this.db.globalBan.findFirst({ where: { userId, active: true }, include: { case: true } });
    if (!ban) return;
    await this.audit.log(guildId, actorId ?? this.client.user!.id, 'GLOBAL_ENFORCEMENT_WARNING',
      { source, recordId: ban.caseId, reason: ban.reason }, userId);
    await this.execute(ban.case, guildId, 'BAN', source);
  }
}
