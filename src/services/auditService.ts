import type { Client } from 'discord.js';
import type { Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import type { Database } from '../database/client.js';
import { discordMention, embed, userRef } from '../utils/core.js';
export class AuditService {
  constructor(private db: Database, private client: Client, private logger: Logger) {}
  async record(guildId: string, actorId: string, action: string, details: Prisma.InputJsonObject, userId?: string) {
    await this.db.moderatorAction.create({ data: { guildId, actorId, action, details, userId } });
  }
  async log(guildId: string, actorId: string, action: string, details: Prisma.InputJsonObject, userId?: string) {
    await this.record(guildId, actorId, action, details, userId);
    const summary = (() => {
      const reason = typeof details.reason === 'string' ? details.reason : undefined;
      const dm = typeof details.dm === 'string' ? details.dm : undefined;
      const recordId = typeof details.recordId === 'number' ? details.recordId : undefined;
      const lines = [`Moderator: ${discordMention(actorId)}`];
      if (userId) lines.push(`Subject: ${userRef(userId)}`);
      if (reason) lines.push(`Reason: ${reason}`);
      if (recordId) lines.push(`Case: VE-${String(recordId).padStart(6, '0')}`);
      if (dm) lines.push(`DM Status: ${dm}`);
      return lines.join('\n');
    })();
    await this.deliver(guildId, action, summary);
  }
  async deliver(guildId: string, title: string, description: string) {
    try {
      const cfg = await this.db.guildConfig.findUnique({ where: { guildId } });
      if (!cfg?.logChannelId) return;
      const channel = await this.client.channels.fetch(cfg.logChannelId);
      if (channel?.isSendable()) await channel.send({ embeds: [embed(title, description)], allowedMentions: { parse: [] } });
    } catch (err) { this.logger.warn({ err, guildId }, 'Discord audit delivery failed; database record retained'); }
  }
}
