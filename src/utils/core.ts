import { EmbedBuilder } from 'discord.js';
export class UserError extends Error {}
export function userId(value: string | undefined): string {
  const match = value?.trim().match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
  const target = match?.[1] ?? match?.[2];
  if (!target || BigInt(target) > 18446744073709551615n) {
    throw new UserError('Provide a Discord user ID or an actual @user mention, not a username, role or channel.');
  }
  // Never convert a snowflake to Number: that would round many real Discord IDs.
  return target;
}
export function id(value: string | undefined): string {
  const result = value?.match(/^(?:<@!?(\d{17,20})>|<#(\d{17,20})>|<@&(\d{17,20})>|(\d{17,20}))$/);
  if (!result) throw new UserError('Provide a valid Discord ID or mention.');
  return result.slice(1).find(Boolean)!;
}
export function required(value: string | undefined, label = 'Reason', max = 1500): string {
  if (!value?.trim() || value.length > max) throw new UserError(`${label} is required (1–${max} characters).`);
  return value.trim();
}
export function integer(value: string | undefined, min: number, max: number): number {
  if (!value || !/^\d+$/.test(value)) throw new UserError(`Enter a whole number from ${min} to ${max}.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new UserError(`Enter a whole number from ${min} to ${max}.`);
  return n;
}
export function discordMention(value: string | undefined): string {
  if (!value) return 'Unknown';
  return /^\d{17,20}$/.test(value) ? `<@${value}>` : value;
}
export function userRef(value: string | undefined): string {
  if (!value) return 'Unknown';
  return /^\d{17,20}$/.test(value) ? `${discordMention(value)} (${value})` : value;
}
export function duration(value: string | undefined): number {
  const m = value?.match(/^(\d+)(s|m|h|d|w|mo|y)$/i);
  if (!m) throw new UserError('Use a duration such as 30m, 1h, 7d, 1w, 1mo or 1y (maximum 28 days for Discord timeouts).');
  const n = Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 }[m[2].toLowerCase()]!);
  if (n < 1 || n > 2419200) throw new UserError('Timeout must be between 1 second and 28 days.');
  return n;
}
export const caseNumber = (n: number) => `VE-${String(n).padStart(6, '0')}`;
export const caseId = (value: string | undefined) => integer(value?.replace(/^VE-/i, ''), 1, 2147483647);
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1800);
export const embed = (title: string, description = '') => new EmbedBuilder().setColor(0x842b35)
  .setTitle(`VENGEFUL ENFORCER — ${title}`).setDescription(description.slice(0, 4000) || null).setTimestamp();
export function evidenceUrl(value: string): string {
  try { const u = new URL(value); if (['https:', 'http:'].includes(u.protocol) && value.length <= 1500) return value; } catch {}
  throw new UserError('Evidence must be an HTTP(S) URL of at most 1500 characters.');
}
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next;
  }
  async drain() { await this.tail; }
}
export async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (error) {
      const e = error as { status?: number; code?: string };
      if (attempt >= 2 || !((e.status ?? 0) >= 500 || ['ECONNRESET', 'ETIMEDOUT'].includes(e.code ?? ''))) throw error;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}
