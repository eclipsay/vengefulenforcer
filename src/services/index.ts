import type { Client } from 'discord.js';
import type { Logger } from 'pino';
import type { Database } from '../database/client.js';
import { PermissionService } from './permissionService.js';
import { AuditService } from './auditService.js';
import { CaseService } from './caseService.js';
import { NotificationService } from './notificationService.js';
import { ModerationService } from './moderationService.js';
import { GlobalBanService } from './globalBanService.js';
import { BanSyncService } from './banSyncService.js';
import { GuildService } from './guildService.js';
import { RecordsService } from './recordsService.js';
import { ChannelService } from './channelService.js';
import { SerialQueue } from '../utils/core.js';
export function createServices(db: Database, client: Client, logger: Logger, config: { GLOBAL_COMMAND_CHANNEL_ID?: string; CLIENT_ID: string }) {
  const permissions = new PermissionService(db, config.GLOBAL_COMMAND_CHANNEL_ID);
  const audit = new AuditService(db, client, logger);
  const cases = new CaseService(db, client);
  const notifications = new NotificationService(db, client);
  const global = new GlobalBanService(db, client, permissions, cases, notifications, audit);
  return { db, client, permissions, audit, cases, notifications, global, queue: new SerialQueue(),
    moderation: new ModerationService(db, permissions, cases, notifications, audit),
    sync: new BanSyncService(db, global, audit, config.CLIENT_ID),
    guild: new GuildService(db, client, permissions, audit),
    records: new RecordsService(db, cases, permissions, audit),
    channel: new ChannelService(db, permissions, audit) };
}
export type Services = ReturnType<typeof createServices>;
