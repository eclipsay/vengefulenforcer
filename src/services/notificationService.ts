import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from 'discord.js';
import type { ModerationCase } from '@prisma/client';
import type { Database } from '../database/client.js';
import { embed, errorText } from '../utils/core.js';

export class NotificationService {
  constructor(private db: Database, private client: Client) {}
  async send(record: ModerationCase): Promise<string> {
    const existing = await this.db.notification.findUnique({ where: { caseId_userId: { caseId: record.id, userId: record.userId } } });
    if (existing) return existing.status;
    const notification = await this.db.notification.create({ data: { caseId: record.id, userId: record.userId } });
    const warning = record.action === 'WARN';
    const appealable = ['BAN','GLOBAL_BAN','GLOBAL_TEMP_BAN'].includes(record.action);
    const text = warning ? `You have received a warning in **${record.guildName}**.`
      : record.action === 'GLOBAL_TEMP_BAN' ? `A temporary global ban has been issued against your account across the Vengeful Enforcer enforcement network. It expires at ${record.expiresAt?.toISOString() ?? 'the stored expiration time'}. Enforcement is about to be attempted.`
      : record.scope === 'GLOBAL' ? 'A global ban has been issued against your account across the Vengeful Enforcer enforcement network. Enforcement is about to be attempted.'
      : `A ban has been issued against your account in **${record.guildName}**. Enforcement is about to be attempted.`;
    let status = 'SENT'; let error: string | undefined;
    try {
      const user = await this.client.users.fetch(record.userId);
      const payload = {
        embeds: [embed(warning ? 'WARNING NOTICE' : 'BAN NOTICE',
          `${text}\n\nReason: ${record.reason}\nDate: ${record.createdAt.toISOString()}\n\n${appealable ? 'Use the button below to submit a ban appeal.' : 'Contact the server staff if you wish to discuss this action.'}`)],
        components: appealable ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`appeal:start:${record.id}`).setLabel('Appeal Ban').setStyle(ButtonStyle.Primary),
        )] : [],
        allowedMentions: { parse: [] },
      };
      await user.send(payload);
    } catch (err) { status = 'FAILED'; error = errorText(err); }
    await this.db.notification.update({ where: { id: notification.id }, data: { status, error } });
    return status;
  }
}
