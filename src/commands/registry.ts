import type { Context } from '../types/context.js';
import type { Services } from '../services/index.js';
import type { Invocation } from './prefix/parser.js';
import { definitions } from './definitions.js';
import { confirm, paginate } from './ui.js';
import { caseId, duration, embed, evidenceUrl, id, integer, required, UserError } from '../utils/core.js';

type Handler = (ctx: Context, args: Record<string,string>, sub?: string) => Promise<unknown>;
export function createRegistry(s: Services, prefix: string) {
  const handlers = new Map<string,Handler>();
  const say = (ctx: Context, text: string) => ctx.reply({ embeds: [embed('RESULT', text)] });
  for (const action of ['ban','unban','kick','timeout','untimeout','warn']) handlers.set(action, async (ctx,a) =>
    say(ctx, await s.moderation.punish(ctx, action.toUpperCase(), id(a.user), required(a.reason), action === 'timeout' ? duration(a.duration) : undefined)));
  for (const action of ['clear','slowmode','lock','unlock']) handlers.set(action, async (ctx,a) =>
    say(ctx, await s.channel.run(ctx, action, action === 'clear' ? integer(a.amount,1,100) : action === 'slowmode' ? integer(a.amount,0,21600) : undefined)));
  handlers.set('globalban', async (ctx,a) => {
    const userId = id(a.user), reason = required(a.reason), evidence = a.evidence ? evidenceUrl(a.evidence) : undefined;
    await s.global.validate(ctx,userId);
    const user = await s.client.users.fetch(userId).catch(() => null);
    const count = (await s.global.guilds()).length;
    await confirm(ctx, `User: ${user?.tag ?? 'Unknown'}\nDiscord ID: ${userId}\nReason: ${reason}\nEvidence: ${evidence ?? 'None'}\nEnforced Servers: **${count}**\n\nConfirm global enforcement? The enabled server list is checked again at execution.`,
      () => s.queue.run(() => s.global.globalBan(ctx,userId,reason,evidence)));
  });
  handlers.set('globalunban', async (ctx,a) => say(ctx, await s.global.globalUnban(ctx,id(a.user),required(a.reason))));
  handlers.set('history', async (ctx,a) => paginate(ctx,p => s.records.history(ctx,id(a.user),p)));
  handlers.set('warnings', async (ctx,a) => paginate(ctx,p => s.records.history(ctx,id(a.user),p,true)));
  handlers.set('note', async (ctx,a,sub) => {
    if (sub === 'list') return paginate(ctx,p => s.records.notes(ctx,id(a.user),p));
    return say(ctx,await s.records.note(ctx,sub!,sub === 'add' ? id(a.user) : integer(a.id,1,2147483647),a.text));
  });
  handlers.set('case', async (ctx,a,sub) => {
    const target = caseId(a.id);
    if (sub === 'view') return paginate(ctx,p => s.records.casePage(ctx,target,p));
    if (sub === 'edit' && a.field !== 'reason') throw new UserError('Only the reason field can be edited.');
    return say(ctx, await s.records.modifyCase(ctx,target,sub!,sub === 'evidence' ? evidenceUrl(required(a.url,'URL')) : required(a.text,'Text')));
  });
  const config = async (ctx: Context, guildId: string) => {
    const [cfg, registry] = await Promise.all([s.db.guildConfig.findUnique({ where:{ guildId } }),s.db.enforcementGuild.findUnique({ where:{ guildId } })]);
    return say(ctx, `Server: ${s.client.guilds.cache.get(guildId)?.name ?? registry?.name ?? 'Unknown'}\nGuild ID: ${guildId}\nRegistered: ${registry && !registry.removedAt ? 'Yes':'No'}\nActive: ${registry?.active ?? false}\nGlobal Enforcement: ${!!registry && !registry.removedAt && registry.enabled && registry.active && cfg?.globalBans !== false ? 'Enabled':'Disabled'}\nManual unban auto-enforcement: ${cfg?.autoEnforce ?? true}\nShared Notes: ${cfg?.shareNotes ?? false}\nModeration Role: ${cfg?.moderatorRoleId ?? 'Not set'}\nAdministrator Role: ${cfg?.adminRoleId ?? 'Not set'}\nLogging Channel: ${cfg?.logChannelId ?? 'Not set'}\nRegistered By: ${registry?.registeredBy ?? '—'}\nRegistration Date: ${registry?.registeredAt.toISOString() ?? '—'}`);
  };
  handlers.set('config', async (ctx,a,sub) => sub === 'view' ? config(ctx,ctx.guild.id) : say(ctx,await s.guild.configure(ctx,sub!,required(a.value,'Value'))));
  const servers = async (ctx: Context) => paginate(ctx,async page => {
    await s.permissions.check(ctx,'network');
    const where = { removedAt:null };
    const total = await s.db.enforcementGuild.count({ where });
    const rows = await s.db.enforcementGuild.findMany({ where, orderBy:{ registeredAt:'asc' },skip:page*10,take:10 });
    const configs = await s.db.guildConfig.findMany({ where:{ guildId:{ in:rows.map(g=>g.guildId) } } });
    return { pages:Math.max(1,Math.ceil(total/10)),embed:embed('NETWORK CONTROL', `Registered Servers: ${total}\n\n${rows.map((g,i)=>`${page*10+i+1}. **${g.name}** (${g.guildId})\nGlobal Enforcement: ${g.enabled && g.active && configs.find(c=>c.guildId===g.guildId)?.globalBans !== false ? 'Enabled':'Disabled'}`).join('\n\n') || 'No servers registered.'}`) };
  });
  handlers.set('servers',servers); handlers.set('network',servers);
  handlers.set('serverinfo',async (ctx,a)=>config(ctx,id(a.guild)));
  handlers.set('enforcement',async (ctx,a,sub)=> {
    if (sub==='list') return servers(ctx);
    if (sub==='info') return config(ctx,id(a.guild));
    return say(ctx,await s.guild.enforcement(ctx,sub!,id(a.guild)));
  });
  const staff: Handler = async (ctx,a,sub)=> {
    if (sub !== 'list') return say(ctx,await s.guild.staff(ctx,sub!,id(a.user),a.role?.toUpperCase()));
    return paginate(ctx,async page=> {
      await s.permissions.check(ctx,'network');
      const total=await s.db.globalModerator.count();
      const rows=await s.db.globalModerator.findMany({ orderBy:{ userId:'asc' },skip:page*15,take:15 });
      return { pages:Math.max(1,Math.ceil(total/15)),embed:embed('GLOBAL STAFF',rows.map(x=>`${x.userId}: ${x.role} • granted by ${x.grantedBy}`).join('\n') || 'No explicit global staff. Control Server administrators and Ban Members permissions still apply.') };
    });
  };
  handlers.set('globalmods',staff); handlers.set('permissions',staff);
  handlers.set('protected',async (ctx,a,sub)=> {
    if (sub !== 'list') return say(ctx,await s.guild.protect(ctx,sub!,id(a.user),a.reason));
    return paginate(ctx,async page=> {
      await s.permissions.check(ctx,'network');
      const total=await s.db.protectedUser.count();
      const rows=await s.db.protectedUser.findMany({ orderBy:{ userId:'asc' },skip:page*5,take:5 });
      return { pages:Math.max(1,Math.ceil(total/5)),embed:embed('PROTECTED USERS',rows.map(x=>`${x.userId}: ${x.reason.slice(0,500)}`).join('\n\n') || 'No protected users.') };
    });
  });
  handlers.set('sync',async ctx=>say(ctx,JSON.stringify(await s.sync.run(ctx.member.id),null,2)));
  handlers.set('help',async ctx=> {
    const categories=[...new Set(definitions.filter(d=>d.category!=='Help').map(d=>d.category))];
    await paginate(ctx,async page=> {
      const category=categories[page];
      const lines=definitions.filter(d=>d.category===category && d.name!=='permissions').flatMap(d=> {
        const usage = (name:string, options: typeof d.options) => `\`${prefix}${name}${(options??[]).map(o=>` ${o.required===false?'[':'<'}${o.name}${o.required===false?']':'>'}`).join('')}\``;
        return d.subcommands ? d.subcommands.map(sub=>`${usage(`${d.name} ${sub.name}`,sub.options)} — ${sub.description}`) : [`${usage(d.name,d.options)} — ${d.description}`];
      });
      return { pages:categories.length,embed:embed('HELP',`**${category}**\n\n${lines.join('\n\n')}\n\nAll commands have / equivalents. IDs work without mentions. Global commands run in the Control Server.\nExample: ${prefix}warn @user Repeated spam\nGlobal evidence: ${prefix}globalban ID Reason --evidence https://example.com/evidence`) };
    });
  });
  return async (ctx: Context, invocation: Invocation) => {
    await s.permissions.check(ctx,invocation.definition.permission);
    const handler=handlers.get(invocation.definition.name);
    if (!handler) throw new UserError('Command unavailable.');
    await handler(ctx,invocation.args,invocation.sub);
  };
}
