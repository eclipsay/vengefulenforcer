import type { Database } from '../database/client.js';
import type { GlobalBanService } from './globalBanService.js';
import type { AuditService } from './auditService.js';
export class BanSyncService {
  constructor(private db: Database, private global: GlobalBanService, private audit: AuditService, private botId: string) {}
  async run(actorId = this.botId) {
    // Unban work was saved atomically with revocation; replay it even after a crash.
    const unfinished = await this.db.moderationCase.findMany({ where: { scope: 'GLOBAL', status: { in: ['PENDING','PARTIAL'] } } });
    for (const record of unfinished) await this.global.processPending(record);
    const guilds = await this.global.guilds();
    const report = { records: 0, guilds: guilds.length, checks: 0, already: 0, reapplied: 0, failed: 0, skipped: 0 };
    let cursor: string | undefined;
    for (;;) {
      const bans = await this.db.globalBan.findMany({ where: { active: true }, include: { case: true }, take: 100,
        orderBy: { userId: 'asc' }, ...(cursor ? { cursor: { userId: cursor }, skip: 1 } : {}) });
      if (!bans.length) break;
      for (const ban of bans) {
        report.records++;
        for (const guild of guilds) {
          report.checks++;
          const status = await this.global.execute(ban.case, guild.guildId, 'BAN', 'SYNC');
          if (status === 'ALREADY_ENFORCED') report.already++;
          else if (status === 'SUCCESS') report.reapplied++;
          else if (status === 'SKIPPED') report.skipped++;
          else report.failed++;
        }
      }
      cursor = bans.at(-1)!.userId;
    }
    // Retain the report without announcing routine sync completion in Discord.
    for (const guild of guilds) await this.audit.record(guild.guildId, actorId, 'Global bans synchronized', report);
    return report;
  }
}
