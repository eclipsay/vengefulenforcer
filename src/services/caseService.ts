import type { ModerationCase, Prisma } from '@prisma/client';
import type { Client } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Context } from '../types/context.js';
export class CaseService {
  constructor(private db: Database, private client: Client) {}
  async data(ctx: Context, userId: string, action: string, reason: string, scope = 'LOCAL', duration?: number) {
    const user = await this.client.users.fetch(userId).catch(() => null);
    return { requestId: ctx.requestId, userId, username: user?.username, moderatorId: ctx.member.id,
      moderatorName: ctx.member.user.tag, guildId: ctx.guild.id, guildName: ctx.guild.name, action, scope, reason,
      duration, expiresAt: duration ? new Date(Date.now() + duration * 1000) : undefined };
  }
  async create(tx: Prisma.TransactionClient, data: Awaited<ReturnType<CaseService['data']>>, evidence?: string): Promise<ModerationCase> {
    await tx.userRecord.upsert({ where: { id: data.userId }, create: { id: data.userId, username: data.username }, update: { username: data.username } });
    return tx.moderationCase.create({ data: { ...data, evidence: evidence ? { create: { authorId: data.moderatorId, url: evidence } } : undefined } });
  }
}
