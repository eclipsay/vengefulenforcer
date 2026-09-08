import type { Prisma } from '@prisma/client';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
import type { CaseService } from './caseService.js';
import type { PermissionService } from './permissionService.js';
import type { AuditService } from './auditService.js';
import { discordMention, embed, required, UserError } from '../utils/core.js';
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
    return `User: ${user?.username ?? 'Unknown'} ${discordMention(userId)}\nGlobal Enforcement: **${ban?.active ? 'ACTIVE' : 'INACTIVE'}**\nWarnings: ${count('WARN')} | Timeouts: ${count('TIMEOUT')}\nKicks: ${count('KICK')} | Local Bans: ${count('BAN')} | Global Bans: ${count('GLOBAL_BAN')} | Notes: ${notes}`;
  }
  async history(ctx: Context, userId: string, page: number, warningsOnly = false) {
    await this.permissions.check(ctx, 'moderator');
    const where = { userId, ...this.scope(ctx), ...(warningsOnly ? { action: 'WARN' } : {}) };
    const total = await this.db.moderationCase.count({ where });
    const records = await this.db.moderationCase.findMany({ where, orderBy: { id: 'desc' }, skip: page * 5, take: 5 });
    return { pages: Math.max(1, Math.ceil(total / 5)), embed: embed(warningsOnly ? 'WARNINGS' : 'SUBJECT RECORD',
      `${await this.summary(ctx, userId)}\n\n${records.map(c => `**${c.action} (${c.status})**\n${c.reason.slice(0, 300)}\nBy ${c.moderatorName} • ${new Date(c.createdAt).toLocaleString('en-US',{ dateStyle:'medium', timeStyle:'short' })}`).join('\n\n') || 'No records.'}\n\nPage ${page + 1}/${Math.max(1, Math.ceil(total / 5))}`) };
  }
  async notes(ctx: Context, userId: string, page: number) {
    await this.permissions.check(ctx, 'moderator');
    const noteWhere = { userId, guildId: { in: await this.noteGuilds(ctx) }, deletedAt: null };
    const notesTotal = await this.db.userNote.count({ where: noteWhere });
    const warningWhere = { userId, ...this.scope(ctx), action: 'WARN' };
    const warningsTotal = await this.db.moderationCase.count({ where: warningWhere });
    const notes = await this.db.userNote.findMany({ where: noteWhere, orderBy: { id: 'desc' }, skip: page * 3, take: 3 });
    const warnings = await this.db.moderationCase.findMany({ where: warningWhere, orderBy: { id: 'desc' }, take: 3 });
    const total = notesTotal + warningsTotal;
    const noteRows = notes.map(n => `**Note #${n.id}** • ${n.moderatorName} (${n.moderatorId})\nServer: ${ctx.guild.client.guilds.cache.get(n.guildId)?.name ?? n.guildId}\n${new Date(n.createdAt).toLocaleString('en-US',{ dateStyle:'medium', timeStyle:'short' })} • Edited ${new Date(n.updatedAt).toLocaleString('en-US',{ dateStyle:'medium', timeStyle:'short' })}\n${n.content.slice(0, 700)}`);
    const warningRows = warnings.map(w => `**Warning** • ${w.moderatorName} (${w.moderatorId})\nServer: ${ctx.guild.client.guilds.cache.get(w.guildId)?.name ?? w.guildId}\n${new Date(w.createdAt).toLocaleString('en-US',{ dateStyle:'medium', timeStyle:'short' })}\n${w.reason.slice(0, 700)}`);
    return { pages: Math.max(1, Math.ceil(total / 3)), embed: embed('NOTES & MODERATION', `${await this.summary(ctx, userId)}\n\n${[...warningRows, ...noteRows].join('\n\n') || 'No notes or warnings.'}\n\nPage ${page + 1}/${Math.max(1, Math.ceil(total / 3))}`) };
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
    await this.audit.log(ctx.guild.id, ctx.member.id, `NOTE_${action}`, { noteId: result.note.id, recordId: result.c.id }, userId);
    return `Note #${result.note.id} ${action} saved.`;
  }
}
