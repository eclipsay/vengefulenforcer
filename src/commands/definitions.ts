import { SlashCommandBuilder } from 'discord.js';
import type { Permission } from '../services/permissionService.js';
export interface Option { name: string; description: string; required?: boolean; rest?: boolean }
export interface Definition {
  name: string; description: string; category: string; permission: Permission;
  aliases?: string[]; options?: Option[]; subcommands?: { name: string; description: string; options?: Option[] }[];
}
const option = (name: string, description: string, rest = false, required = true): Option => ({ name, description, rest, required });
const user = option('user','Discord user ID or mention');
const reason = option('reason','Reason for this action',true);
const guild = option('guild','Discord guild ID');
const noteId = option('id','Permanent note ID');
const caseId = option('id','Case number, for example VE-000123');
export const definitions: Definition[] = [
  ...['ban','unban','kick','timeout','untimeout','warn'].map(name => ({ name, description: `${name} a Discord user`, category:'Moderation',
    permission: ({ ban:'ban',unban:'ban',kick:'kick',timeout:'timeout',untimeout:'timeout',warn:'moderator' } as const)[name as 'ban'] as Permission,
    options: [user, ...(name === 'timeout' ? [option('duration','Duration such as 30m, 1h or 7d')] : []), reason] })),
  ...['clear','slowmode','lock','unlock'].map(name => ({ name, description: `${name} in the current channel`, category:'Moderation', permission: (name === 'clear' ? 'messages':'channel') as Permission,
    options: ['clear','slowmode'].includes(name) ? [option('amount',name === 'clear' ? 'Messages to remove (1–100)' : 'Slowmode seconds (0–21600)')] : [] })),
  { name:'globalban', aliases:['gban','gb'], description:'Ban across enabled enforcement servers', category:'Global Enforcement', permission:'global', options:[user,reason,option('evidence','Optional evidence URL',false,false)] },
  { name:'globalunban', aliases:['gunban'], description:'Revoke an active global ban', category:'Global Enforcement', permission:'global', options:[user,reason] },
  { name:'history', aliases:['hist','record'], description:'Permanent subject record', category:'User Records', permission:'moderator', options:[user] },
  { name:'warnings', description:'List permanent warnings', category:'User Records', permission:'moderator', options:[user] },
  { name:'note', description:'Permanent staff notes', category:'Notes', permission:'moderator', subcommands:[
    { name:'add', description:'Add a note', options:[user,option('text','Note content',true)] },
    { name:'list', description:'List notes', options:[user] },
    { name:'edit', description:'Edit a note with an audit trail', options:[noteId,option('text','Replacement content',true)] },
    { name:'remove', description:'Soft-delete a note', options:[noteId] },
  ] },
  { name:'case', description:'Inspect and update cases', category:'Cases', permission:'moderator', subcommands:[
    { name:'view', description:'View case and execution records', options:[caseId] },
    { name:'edit', description:'Edit case reason', options:[caseId,option('field','Use reason'),option('text','New reason',true)] },
    { name:'comment', description:'Add moderator comment', options:[caseId,option('text','Comment',true)] },
    { name:'evidence', description:'Add evidence URL', options:[caseId,option('url','Evidence URL')] },
  ] },
  { name:'config', description:'Guild configuration', category:'Configuration', permission:'admin', subcommands:[
    { name:'view', description:'Show configuration' },
    ...['logchannel','modrole','adminrole','globalbans','notes','autoenforce'].map(name => ({ name, description:`Configure ${name}`, options:[option('value','Channel/role mention, none, or on/off as appropriate')] })),
  ] },
  { name:'enforcement', description:'Manage participating servers', category:'Network Administration', permission:'network', subcommands:[
    ...['add','remove','enable','disable','info'].map(name => ({ name, description:`${name} an enforcement server`, options:[guild] })),
    { name:'list', description:'List registered servers' },
  ] },
  { name:'servers', description:'List the enforcement network', category:'Network Administration', permission:'network' },
  { name:'network', description:'Show network control overview', category:'Network Administration', permission:'network' },
  { name:'serverinfo', description:'Inspect an enforcement server', category:'Network Administration', permission:'network', options:[guild] },
  { name:'globalmods', aliases:['permissions'], description:'Global staff permissions', category:'Network Administration', permission:'network', subcommands:[
    { name:'list', description:'List global staff' },
    { name:'add', description:'Owner: grant staff permissions', options:[user,option('role','ADMIN or MODERATOR')] },
    { name:'remove', description:'Owner: revoke staff permissions', options:[user] },
  ] },
  { name:'protected', description:'Manage protected users', category:'Network Administration', permission:'network', subcommands:[
    { name:'list', description:'List protected users' },
    { name:'add', description:'Protect a user from global bans', options:[user,reason] },
    { name:'remove', description:'Remove user protection', options:[user] },
  ] },
  { name:'sync', description:'Restore missing global bans', category:'Network Administration', permission:'network', subcommands:[{ name:'bans', description:'Synchronize persistent global bans' }] },
  { name:'help', description:'Command reference and examples', category:'Help', permission:'public' },
];
// permissions is also a first-class slash fallback, rather than only a prefix alias.
definitions.push({ ...definitions.find(d => d.name === 'globalmods')!, name:'permissions', aliases:[] });

export function slashDefinitions() {
  return definitions.map(def => {
    const command = new SlashCommandBuilder().setName(def.name).setDescription(def.description).setDMPermission(false);
    if (def.subcommands) for (const sub of def.subcommands) command.addSubcommand(builder => {
      builder.setName(sub.name).setDescription(sub.description);
      for (const o of sub.options ?? []) builder.addStringOption(v => v.setName(o.name).setDescription(o.description).setRequired(o.required !== false).setMaxLength(1500));
      return builder;
    });
    else for (const o of def.options ?? []) command.addStringOption(v => v.setName(o.name).setDescription(o.description).setRequired(o.required !== false).setMaxLength(1500));
    return command.toJSON();
  });
}
