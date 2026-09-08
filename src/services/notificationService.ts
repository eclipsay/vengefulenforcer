import type { Client } from 'discord.js';
import type { ModerationCase } from '@prisma/client';
import type { Database } from '../database/client.js';
import { caseNumber, embed, errorText } from '../utils/core.js';

export class NotificationService {
  constructor(private db: Database, private client: Client) {}
  async send(record: ModerationCase): Promise<string> {
    const existing = await this.db.notification.findUnique({ where: { caseId_userId: { caseId: record.id, userId: record.userId } } });
    if (existing) return existing.status;
    const notification = await this.db.notification.create({ data: { caseId: record.id, userId: record.userId } });
    const warning = record.action === 'WARN';
    const text = warning ? `You have received a warning in **${record.guildName}**.`
      : record.scope === 'GLOBAL' ? 'A global ban has been issued against your account across the Vengeful Enforcer enforcement network. Enforcement is about to be attempted.'
      : `A ban has been issued against your account in **${record.guildName}**. Enforcement is about to be attempted.`;
    let status = 'SENT'; let error: string | undefined;
    try {
      const user = await this.client.users.fetch(record.userId);
      await user.send({ embeds: [embed(warning ? 'WARNING NOTICE' : 'BAN NOTICE',
        `${text}\n\nReason: ${record.reason}\nCase: **${caseNumber(record.id)}**\nDate: ${record.createdAt.toISOString()}\n\nContact the server staff if you wish to discuss this action.`)], allowedMentions: { parse: [] } });
    } catch (err) { status = 'FAILED'; error = errorText(err); }
    await this.db.notification.update({ where: { id: notification.id }, data: { status, error } });
    return status;
  }
}
