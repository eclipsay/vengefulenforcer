import type { Context } from '../types/context.js';
import type { Services } from '../services/index.js';
import type { Invocation } from './prefix/parser.js';
import { definitions } from './definitions.js';
import { paginate } from './ui.js';
import { duration, embed, evidenceUrl, userId, integer, required, UserError } from '../utils/core.js';

type Handler = (ctx: Context, args: Record<string,string>, sub?: string) => Promise<unknown>;
export function createRegistry(s: Services, prefix: string) {
  const handlers = new Map<string,Handler>();
  const say = (ctx: Context, text: string) => ctx.reply({ embeds: [embed('RESULT', text)] });
  for (const action of ['ban','unban','kick','timeout','untimeout','warn']) handlers.set(action, async (ctx,a) =>
    say(ctx, await s.moderation.punish(ctx, action.toUpperCase(), userId(a.user), required(a.reason), action === 'timeout' ? duration(a.duration) : undefined)));
  for (const action of ['clear','slowmode','lock','unlock']) handlers.set(action, async (ctx,a) =>
    say(ctx, await s.channel.run(ctx, action, action === 'clear' ? integer(a.amount,1,100) : action === 'slowmode' ? integer(a.amount,0,21600) : undefined)));
  handlers.set('globalban', async (ctx,a) => say(ctx, await s.global.globalBan(ctx,userId(a.user),required(a.reason),a.evidence ? evidenceUrl(a.evidence) : undefined)));
  handlers.set('globalunban', async (ctx,a) => say(ctx, await s.global.globalUnban(ctx,userId(a.user),required(a.reason))));
  handlers.set('notes', async (ctx,a) => paginate(ctx,p => s.records.notes(ctx,userId(a.user),p)));
  handlers.set('note', async (ctx,a,sub) => {
    return say(ctx,await s.records.note(ctx,sub!,sub === 'add' ? userId(a.user) : integer(a.id,1,2147483647),a.text));
  });
  handlers.set('config', async (ctx,a,sub) => {
    if (sub !== 'view') return say(ctx,await s.guild.configure(ctx,sub!,required(a.value,'Channel')));
    const cfg=await s.db.guildConfig.findUnique({where:{guildId:ctx.guild.id}});
    const channel=await s.permissions.commandChannel(ctx.guild.id);
    return say(ctx, 'Global bans: automatically enabled in all '+s.client.guilds.cache.size+' joined servers.\nGlobal command channel: '+(channel ? '<#'+channel+'>' : 'Not set. Use -config globalchannel #channel.')+'\nLog channel: '+(cfg?.logChannelId ? '<#'+cfg.logChannelId+'>' : 'Not set (optional).'));
  });
  handlers.set('help',async ctx=> {
    const categories=[...new Set(definitions.filter(d=>d.category!=='Help').map(d=>d.category))];
    await paginate(ctx,async page=> {
      const category=categories[page];
      const lines=definitions.filter(d=>d.category===category).flatMap(d=> {
        const usage = (name:string, options: typeof d.options) => `\`${prefix}${name}${(options??[]).map(o=>` ${o.required===false?'[':'<'}${o.name}${o.required===false?']':'>'}`).join('')}\``;
        return d.subcommands ? d.subcommands.map(sub=>`${usage(`${d.name} ${sub.name}`,sub.options)} — ${sub.description}`) : [`${usage(d.name,d.options)} — ${d.description}`];
      });
      const setup = category === 'Configuration' ? `\n\n**Setup**\n1. Set the Main Server in env as CONTROL_GUILD_ID.\n2. Invite the bot to each faction guild and register it with ${prefix}enforcement add <guild_id>.\n3. Assign moderator/admin roles with ${prefix}config logchannel #channel and ${prefix}config globalbans on.\n4. Use ${prefix}globalban <user|id> <reason> to enforce across registered guilds.\n\n**Duration shorthand**\n${prefix}timeout @user 1d 2h reason\n${prefix}timeout @user 1w reason\n${prefix}timeout @user 1mo reason\n${prefix}timeout @user 1y reason\n(Discord enforces a 28-day maximum timeout.)` : '';
      return { pages:categories.length,embed:embed('HELP',`**${category}**\n\n${lines.join('\n\n')}${setup}\n\nAll commands have / equivalents. IDs work without mentions. Global commands need Ban Members and the configured global command channel.\nExample: ${prefix}warn @user Repeated spam\nGlobal evidence: ${prefix}globalban ID Reason --evidence https://example.com/evidence`) };
    });
  });
  return async (ctx: Context, invocation: Invocation) => {
    await s.permissions.check(ctx,invocation.definition.permission);
    const handler=handlers.get(invocation.definition.name);
    if (!handler) throw new UserError('Command unavailable.');
    await handler(ctx,invocation.args,invocation.sub);
  };
}
