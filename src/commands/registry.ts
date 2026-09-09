import type { Context } from '../types/context.js';
import type { Services } from '../services/index.js';
import type { Invocation } from './prefix/parser.js';
import { paginate } from './ui.js';
import { duration, embed, evidenceUrl, globalBanDuration, userId, integer, required, UserError } from '../utils/core.js';

type Handler = (ctx: Context, args: Record<string,string>, sub?: string) => Promise<unknown>;

export function createRegistry(s: Services, prefix: string) {
  const handlers = new Map<string,Handler>();
  const say = (ctx: Context, text: string) => ctx.reply({ embeds: [embed('RESULT', text)] });

  for (const action of ['ban','unban','kick','timeout','untimeout','warn']) {
    handlers.set(action, async (ctx,a) => say(ctx, await s.moderation.punish(
      ctx, action.toUpperCase(), userId(a.user), required(a.reason), action === 'timeout' ? duration(a.duration) : undefined,
    )));
  }
  for (const action of ['clear','slowmode','lock','unlock']) {
    handlers.set(action, async (ctx,a) => say(ctx, await s.channel.run(
      ctx, action, action === 'clear' ? integer(a.amount,1,100) : action === 'slowmode' ? integer(a.amount,0,21600) : undefined,
    )));
  }

  handlers.set('globalban', async (ctx,a) => say(ctx, await s.global.globalBan(ctx,userId(a.user),required(a.reason),a.evidence ? evidenceUrl(a.evidence) : undefined)));
  handlers.set('globaltempban', async (ctx,a) => say(ctx, await s.global.globalTempBan(ctx,userId(a.user),globalBanDuration(a.duration),required(a.reason),a.evidence ? evidenceUrl(a.evidence) : undefined)));
  handlers.set('globalunban', async (ctx,a) => say(ctx, await s.global.globalUnban(ctx,userId(a.user),required(a.reason))));
  handlers.set('notes', async (ctx,a) => paginate(ctx,p => s.records.notes(ctx,userId(a.user),p)));
  handlers.set('note', async (ctx,a,sub) =>
    say(ctx,await s.records.note(ctx,sub!,sub === 'add' ? userId(a.user) : integer(a.id,1,2147483647),a.text)));

  handlers.set('config', async (ctx,a,sub) => {
    if (sub === 'appealrole') return say(ctx,await s.guild.appealRole(ctx,required(a.action,'Action'),a.role));
    if (sub !== 'view') return say(ctx,await s.guild.configure(ctx,sub!,required(a.value,'Value')));
    const cfg=await s.db.guildConfig.findUnique({where:{guildId:ctx.guild.id}});
    const appealRoles=await s.db.appealRole.findMany({where:{guildId:ctx.guild.id},orderBy:{id:'asc'}});
    const channel=await s.permissions.commandChannel(ctx.guild.id);
    return say(ctx,
      'Global bans: automatically enabled in all '+s.client.guilds.cache.size+' joined servers.'+
      '\nGlobal command channel: '+(channel ? '<#'+channel+'>' : 'Not set. Use -config globalchannel #channel.')+
      '\nAppeal category: '+(cfg?.appealCategoryId ? cfg.appealCategoryId : 'Not set. Use -config appealcategory CATEGORY_ID.')+
      '\nAppeal staff roles: '+(appealRoles.length ? appealRoles.map(r=>'<@&'+r.roleId+'>').join(', ') : 'Not set. Use -config appealrole add @Role.')+
      '\nLog channel: '+(cfg?.logChannelId ? '<#'+cfg.logChannelId+'>' : 'Not set (optional).'));
  });

  handlers.set('help',async ctx=> {
    const pages = [
      { title:'Quick Start', body:`**Required setup**
\`${prefix}config globalchannel #global-bans\`
\`${prefix}config appealcategory CATEGORY_ID\`
\`${prefix}config appealrole add @Appeal Staff\`

Global bans work in the configured global channel only. Anyone with Discord Ban Members there can use them. Every command also has a slash version.` },
      { title:'Global Enforcement', body:`\`${prefix}globalban <user/id> <reason>\`
Bans the user from every server the bot is in and DMs an appeal button.

\`${prefix}globaltempban <user/id> <time> <reason>\`
Same as globalban, but automatically expires. Example: \`${prefix}globaltempban 123456789012345678 7d Ban evasion\`.

\`${prefix}globalunban <user/id> <reason>\`
Removes an active global ban and unbans them from every joined server.

Aliases: \`${prefix}gban\`, \`${prefix}gb\`, \`${prefix}gtban\`, \`${prefix}gtb\`, \`${prefix}gunban\`.` },
      { title:'Appeals', body:`Ban DMs include an Appeal Ban button. The user fills out name, Discord ID, reason for ban, and why they believe they should be unbanned.

The bot opens a staff-side channel under the configured appeal category. Only configured appeal roles and the bot can see it.

Setup:
\`${prefix}config appealcategory CATEGORY_ID\`
\`${prefix}config appealrole add @Appeal Staff\`
\`${prefix}config appealrole remove @OldRole\`
\`${prefix}config appealrole list\`` },
      { title:'Moderation', body:`\`${prefix}ban <user/id> <reason>\` - local ban, DM, and message cleanup
\`${prefix}unban <user/id> <reason>\` - local unban
\`${prefix}kick <user/id> <reason>\` - kick a current member
\`${prefix}timeout <user/id> <time> <reason>\` - timeout up to 28 days
\`${prefix}untimeout <user/id> <reason>\` - remove timeout
\`${prefix}warn <user/id> <reason>\` - save warning and DM
\`${prefix}clear 10\`, \`${prefix}slowmode 10\`, \`${prefix}lock\`, \`${prefix}unlock\`` },
      { title:'Notes And History', body:`\`${prefix}note add <user/id> <text>\` - save a permanent note
\`${prefix}note edit <note_id> <text>\` - edit a note
\`${prefix}note remove <note_id>\` - hide a note from the active list
\`${prefix}history <user/id>\` - show record
\`${prefix}warnings <user/id>\` - show warnings and notes

Raw Discord IDs and user mentions both work. Typed usernames do not.` },
      { title:'Configuration', body:`\`${prefix}config\` - show settings
\`${prefix}config globalchannel #channel\` - where globalban/globaltempban/globalunban are allowed
\`${prefix}config appealcategory CATEGORY_ID\` - category where appeal channels are created
\`${prefix}config appealrole add @Role\` - add a role that can see appeal channels
\`${prefix}config appealrole remove @Role\` - remove an appeal role
\`${prefix}config appealrole list\` - show appeal roles
\`${prefix}config logchannel #channel\` - optional mod logs

Use \`none\` to clear a setting.` },
    ];
    await paginate(ctx,async page=> {
      const item = pages[page];
      return { pages:pages.length,embed:embed('HELP',`**${item.title}**\n\n${item.body}`) };
    });
  });

  return async (ctx: Context, invocation: Invocation) => {
    await s.permissions.check(ctx,invocation.definition.permission);
    const handler=handlers.get(invocation.definition.name);
    if (!handler) throw new UserError('Command unavailable.');
    await handler(ctx,invocation.args,invocation.sub);
  };
}
