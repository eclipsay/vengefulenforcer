import type { Prisma } from '@prisma/client';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import type { CaseService } from './caseService.js';
import type { PermissionService } from './permissionService.js';
import type { AuditService } from './auditService.js';
import { caseNumber, embed, required, UserError } from '../utils/core.js';
export class RecordsService {
  constructor(private db: Database, private cases: CaseService, private permissions: PermissionService, private audit: AuditService) {}
  scope(ctx: Context): Prisma.ModerationCaseWhereInput { return { OR: [{ guildId: ctx.guild.id }, { scope: 'GLOBAL' }] }; }
  async noteGuilds(ctx: Context) {
    const own = ctx.guild.id;
    const cfg = await this.db.guildConfig.findUnique({ where: { guildId: own } });
    const registry = await this.db.enforcementGuild.findFirst({ where: { guildId: own, active: true, removedAt: null } });
    if (!cfg?.shareNotes || !registry) return [own];
    const registered = await this.db.enforcementGuild.findMany({ where: { active: true, removedAt: null } });
    const shared = await this.db.guildConfig.findMany({ where: { shareNotes: true, guildId: { in: registered.map(g => g.guildId) } } });
    return [...new Set([own, ...shared.map(g => g.guildId)])];
  }
  async summary(ctx: Context, userId: string) {
    const where = { userId, ...this.scope(ctx) };
    const [groups, total, ban, notes, user] = await Promise.all([
      this.db.moderationCase.groupBy({ by: ['action'], where: { ...where, status: { in: ['SUCCESS','PARTIAL'] } }, _count: true }),
      this.db.moderationCase.count({ where }),
      this.db.globalBan.findUnique({ where: { userId } }),
      this.db.userNote.count({ where: { userId, guildId: { in: await this.noteGuilds(ctx) }, deletedAt: null } }),
      this.db.userRecord.findUnique({ where: { id: userId } }),
    ]);
    const count = (action: string) => groups.find(g => g.action === action)?._count ?? 0;
    return `User: ${user?.username ?? 'Unknown'} (${userId})\nGlobal Enforcement: **${ban?.active ? 'ACTIVE' : 'INACTIVE'}**\nCases: ${total} | Warnings: ${count('WARN')} | Timeouts: ${count('TIMEOUT')}\nKicks: ${count('KICK')} | Local Bans: ${count('BAN')} | Global Bans: ${count('GLOBAL_BAN')} | Notes: ${notes}`;
  }
  async history(ctx: Context, userId: string, page: number, warningsOnly = false) {
    await this.permissions.check(ctx, 'moderator');
    const where = { userId, ...this.scope(ctx), ...(warningsOnly ? { action: 'WARN' } : {}) };
    const total = await this.db.moderationCase.count({ where });
    const records = await this.db.moderationCase.findMany({ where, orderBy: { id: 'desc' }, skip: page * 5, take: 5 });
    return { pages: Math.max(1, Math.ceil(total / 5)), embed: embed(warningsOnly ? 'WARNINGS' : 'SUBJECT RECORD',
      `${await this.summary(ctx, userId)}\n\n${records.map(c => `**${caseNumber(c.id)} — ${c.action} (${c.status})**\n${c.reason.slice(0, 300)}\nBy ${c.moderatorName} • ${c.createdAt.toISOString()}`).join('\n\n') || 'No records.'}\n\nPage ${page + 1}/${Math.max(1, Math.ceil(total / 5))} • Use case view for evidence, edits, delivery and execution results.`) };
  }
  async notes(ctx: Context, userId: string, page: number) {
    await this.permissions.check(ctx, 'moderator');
    const where = { userId, guildId: { in: await this.noteGuilds(ctx) }, deletedAt: null };
    const total = await this.db.userNote.count({ where });
    const notes = await this.db.userNote.findMany({ where, orderBy: { id: 'desc' }, skip: page * 3, take: 3 });
    return { pages: Math.max(1, Math.ceil(total / 3)), embed: embed('NOTES', `${await this.summary(ctx, userId)}\n\n${notes.map(n =>
      `**Note #${n.id}** • ${n.moderatorName} (${n.moderatorId})\nServer: ${ctx.guild.client.guilds.cache.get(n.guildId)?.name ?? n.guildId}\n${n.createdAt.toISOString()} • Edited ${n.updatedAt.toISOString()}\n${n.content.slice(0, 700)}`).join('\n\n') || 'No notes.'}\n\nPage ${page + 1}/${Math.max(1, Math.ceil(total / 3))}`) };
  }
  async note(ctx: Context, action: string, target: string | number, content?: string) {
    await this.permissions.check(ctx, 'moderator');
    const prior = action === 'add' ? null : await this.db.userNote.findFirst({ where: { id: Number(target), guildId: ctx.guild.id, deletedAt: null } });
    if (action !== 'add' && !prior) throw new UserError('Note not found in this server. Shared notes can only be changed in their originating server.');
    const userId = prior?.userId ?? String(target);
    const text = action === 'remove' ? 'Note removed' : required(content, 'Note');
    const data = await this.cases.data(ctx, userId, `NOTE_${action.toUpperCase()}`, text);
    const result = await this.db.$transaction(async tx => {
      const c = await this.cases.create(tx, data);
      const note = action === 'add' ? await tx.userNote.create({ data: { userId, guildId: ctx.guild.id, moderatorId: ctx.member.id, moderatorName: ctx.member.user.tag, content: text } })
        : await tx.userNote.update({ where: { id: prior!.id }, data: action === 'remove' ? { deletedAt: new Date() } : { content: text } });
      await tx.moderationCase.update({ where: { id: c.id }, data: { status: 'SUCCESS', reason: `Note #${note.id}: ${text}` } });
      await tx.caseAuditLog.create({ data: { caseId: c.id, editorId: ctx.member.id, action: `NOTE_${action}`, oldValue: prior?.content, newValue: text } });
      return { note, c };
    });
    await this.audit.log(ctx.guild.id, ctx.member.id, `NOTE_${action}`, { noteId: result.note.id, case: caseNumber(result.c.id) }, userId);
    return `Note #${result.note.id} ${action}: ${caseNumber(result.c.id)}.`;
  }
  async getCase(ctx: Context, caseId: number) {
    await this.permissions.check(ctx, 'moderator');
    const record = await this.db.moderationCase.findFirst({ where: { id: caseId, ...this.scope(ctx) } });
    if (!record) throw new UserError('Case not found or belongs to another server.');
    return record;
  }
  async casePage(ctx: Context, caseId: number, page: number) {
    const c = await this.getCase(ctx, caseId);
    // Separate sections with independent offsets avoid loading an unbounded execution history.
    const [comments, evidence, audits, executions, dm, counts] = await Promise.all([
      this.db.caseComment.findMany({ where: { caseId }, orderBy: { id: 'desc' }, skip: page * 2, take: 2 }),
      this.db.caseEvidence.findMany({ where: { caseId }, orderBy: { id: 'desc' }, skip: page * 2, take: 2 }),
      this.db.caseAuditLog.findMany({ where: { caseId }, orderBy: { id: 'desc' }, skip: page * 2, take: 2 }),
      this.db.globalBanExecution.findMany({ where: { caseId }, orderBy: { id: 'desc' }, skip: page * 3, take: 3 }),
      this.db.notification.findMany({ where: { caseId } }),
      Promise.all([this.db.caseComment.count({ where: { caseId } }), this.db.caseEvidence.count({ where: { caseId } }), this.db.caseAuditLog.count({ where: { caseId } }), this.db.globalBanExecution.count({ where: { caseId } })]),
    ]);
    const pages = Math.max(1, Math.ceil(counts[0]/2), Math.ceil(counts[1]/2), Math.ceil(counts[2]/2), Math.ceil(counts[3]/3));
    const details = [
      ...comments.map(x => `Comment by ${x.authorId} (${x.createdAt.toISOString()}): ${x.content.slice(0, 250)}`),
      ...evidence.map(x => `Evidence by ${x.authorId}: ${x.url.slice(0, 250)}`),
      ...audits.map(x => `Edit by ${x.editorId} (${x.createdAt.toISOString()}): ${x.oldValue?.slice(0, 100) ?? '—'} → ${x.newValue.slice(0, 100)}`),
      ...executions.map(x => `${x.guildId}: ${x.action} ${x.status} (${x.source}) ${x.error?.slice(0, 120) ?? ''}`),
    ];
    return { pages, embed: embed('CASE FILE', `**${caseNumber(c.id)} — ${c.action} / ${c.scope} / ${c.status}**\nUser: ${c.username ?? 'Unknown'} (${c.userId})\nModerator: ${c.moderatorName} (${c.moderatorId})\nServer: ${c.guildName} (${c.guildId})\nDate: ${c.createdAt.toISOString()}\nDuration: ${c.duration ?? '—'} seconds • Expiration: ${c.expiresAt?.toISOString() ?? '—'}\nReason: ${c.reason.slice(0, 900)}\n${c.error ? `Error: ${c.error.slice(0, 200)}\n` : ''}DM: ${dm.map(n => `${n.status}${n.error ? ` (${n.error.slice(0, 100)})` : ''}`).join(', ') || 'Not requested'}\n\n${details.join('\n\n')}\n\nPage ${page+1}/${pages}`) };
  }
  async modifyCase(ctx: Context, caseId: number, action: string, value: string) {
    const record = await this.getCase(ctx, caseId);
    await this.permissions.check(ctx, record.scope === 'GLOBAL' ? 'global' : 'moderator');
    const eventData = await this.cases.data(ctx, record.userId, `CASE_${action.toUpperCase()}`, `${caseNumber(caseId)}: ${value}`, record.scope);
    await this.db.$transaction(async tx => {
      if (action === 'edit') {
        await tx.moderationCase.update({ where: { id: caseId }, data: { reason: value } });
        await tx.globalBan.updateMany({ where: { caseId, active: true }, data: { reason: value } });
      } else if (action === 'comment') await tx.caseComment.create({ data: { caseId, authorId: ctx.member.id, content: value } });
      else await tx.caseEvidence.create({ data: { caseId, authorId: ctx.member.id, url: value } });
      await tx.caseAuditLog.create({ data: { caseId, editorId: ctx.member.id, action, oldValue: action === 'edit' ? record.reason : null, newValue: value } });
      const event = await this.cases.create(tx, { ...eventData, username: record.username ?? undefined });
      await tx.moderationCase.update({ where: { id: event.id }, data: { status: 'SUCCESS' } });
    });
    await this.audit.log(ctx.guild.id, ctx.member.id, `CASE_${action}`, { case: caseNumber(caseId), value }, record.userId);
    return `${caseNumber(caseId)} updated; audit trail saved.`;
  }
}
