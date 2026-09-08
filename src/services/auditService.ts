import type { Client } from 'discord.js';
import type { Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import type { Database } from '../database/client.js';
import { embed } from '../utils/core.js';
export class AuditService {
  constructor(private db: Database, private client: Client, private logger: Logger) {}
  async log(guildId: string, actorId: string, action: string, details: Prisma.InputJsonObject, userId?: string) {
    await this.db.moderatorAction.create({ data: { guildId, actorId, action, details, userId } });
    await this.deliver(guildId, action, `Actor: ${actorId}${userId ? `\nSubject: ${userId}` : ''}\n${JSON.stringify(details)}`);
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
