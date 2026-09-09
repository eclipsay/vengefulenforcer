import { PermissionFlagsBits as P, type Guild } from 'discord.js';
import { errorText, retry } from '../utils/core.js';

export const BAN_DELETE_SECONDS = 7 * 24 * 60 * 60;
const CLEANUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export class MessageCleanupService {
  async deleteUserMessages(guild: Guild, userId: string) {
    const report = { deleted: 0, failed: 0, channels: 0 };
    const cutoff = Date.now() - CLEANUP_WINDOW_MS;
    const me = await guild.members.fetchMe();
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased() || !('messages' in channel) || !channel.permissionsFor(me)?.has([P.ViewChannel, P.ReadMessageHistory, P.ManageMessages])) continue;
      report.channels++;
      let before: string | undefined;
      for (let page = 0; page < 100; page++) {
        const messages = await retry(() => channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }));
        if (!messages.size) break;
        let reachedCutoff = false;
        for (const message of messages.values()) {
          if (message.createdTimestamp < cutoff) { reachedCutoff = true; break; }
          if (message.author.id !== userId) continue;
          try { await retry(() => message.delete()); report.deleted++; }
          catch { report.failed++; }
        }
        before = messages.last()?.id;
        if (reachedCutoff || !before) break;
      }
    }
    return { ...report, summary: report.failed ? `${report.deleted} deleted, ${report.failed} failed` : `${report.deleted} deleted` };
  }
  async safeDeleteUserMessages(guild: Guild, userId: string) {
    try { return await this.deleteUserMessages(guild, userId); }
    catch (err) { return { deleted: 0, failed: 1, channels: 0, summary: `cleanup failed: ${errorText(err)}` }; }
  }
}
