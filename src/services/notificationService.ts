import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from 'discord.js';
import type { ModerationCase } from '@prisma/client';
import type { Database } from '../database/client.js';
import { embed, errorText } from '../utils/core.js';

const discordTime = (date: Date) => `<t:${Math.floor(date.getTime() / 1000)}:F>`;

export class NotificationService {
  constructor(private db: Database, private client: Client) {}
  async send(record: ModerationCase): Promise<string> {
    const existing = await this.db.notification.findUnique({ where: { caseId_userId: { caseId: record.id, userId: record.userId } } });
    if (existing) return existing.status;
    const notification = await this.db.notification.create({ data: { caseId: record.id, userId: record.userId } });
    const warning = record.action === 'WARN';
    const appealable = ['BAN','GLOBAL_BAN','GLOBAL_TEMP_BAN'].includes(record.action);
    const config = appealable ? await this.db.guildConfig.findUnique({ where: { guildId: record.guildId } }) : null;
    const appealUrl = config?.appealUrl;
    const title = warning ? 'WARNING NOTICE' : 'BAN NOTICE';
    const heading = warning ? `You received a warning in **${record.guildName}**.`
      : record.action === 'GLOBAL_TEMP_BAN' ? `You have been temporarily banned from Vengeful Realms.`
      : record.scope === 'GLOBAL' ? 'You have been banned from Vengeful Realms.'
      : `You have been banned from **${record.guildName}**.`;
    const expiry = record.action === 'GLOBAL_TEMP_BAN' && record.expiresAt ? `\nExpires: ${discordTime(record.expiresAt)}` : '';
    const footer = appealable && appealUrl ? 'If you believe this was a mistake, you can submit an appeal below.'
      : appealable ? 'If you believe this was a mistake, contact the staff team for appeal instructions.'
      : 'Please respect the server rules moving forward.';
    let status = 'SENT'; let error: string | undefined;
    try {
      const user = await this.client.users.fetch(record.userId);
      const payload = {
        embeds: [embed(title,
          `${heading}\n\nReason: ${record.reason}\nDate: ${discordTime(record.createdAt)}${expiry}\n\n${footer}`)],
        components: appealUrl ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel('Appeal Ban').setStyle(ButtonStyle.Link).setURL(appealUrl),
        )] : [],
        allowedMentions: { parse: [] },
      };
      await user.send(payload);
    } catch (err) { status = 'FAILED'; error = errorText(err); }
    await this.db.notification.update({ where: { id: notification.id }, data: { status, error } });
    return status;
  }
}
