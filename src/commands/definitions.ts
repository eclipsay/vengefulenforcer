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
const noteId = option('id','Permanent note ID');
export const definitions: Definition[] = [
  ...['ban','unban','kick','timeout','untimeout','warn'].map(name => ({ name, description: `${name} a Discord user`, category:'Moderation',
    permission: ({ ban:'ban',unban:'ban',kick:'kick',timeout:'timeout',untimeout:'timeout',warn:'moderator' } as const)[name as 'ban'] as Permission,
    options: [user, ...(name === 'timeout' ? [option('duration','Duration such as 30m, 1h or 7d')] : []), reason] })),
  ...['clear','slowmode','lock','unlock'].map(name => ({ name, description: `${name} in the current channel`, category:'Moderation', permission: (name === 'clear' ? 'messages':'channel') as Permission,
    options: ['clear','slowmode'].includes(name) ? [option('amount',name === 'clear' ? 'Messages to remove (1–100)' : 'Slowmode seconds (0–21600)')] : [] })),
  { name:'globalban', aliases:['gban','gb'], description:'Ban across every server the bot is in', category:'Global Enforcement', permission:'global', options:[user,reason,option('evidence','Optional evidence URL',false,false)] },
  { name:'globalunban', aliases:['gunban'], description:'Revoke an active global ban', category:'Global Enforcement', permission:'global', options:[user,reason] },
  { name:'history', aliases:['hist','record'], description:'Permanent subject record', category:'User Records', permission:'moderator', options:[user] },
  { name:'warnings', description:'List permanent warnings', category:'User Records', permission:'moderator', options:[user] },
  { name:'note', description:'Permanent staff notes', category:'Notes', permission:'moderator', subcommands:[
    { name:'add', description:'Add a note', options:[user,option('text','Note content',true)] },
    { name:'list', description:'List notes', options:[user] },
    { name:'edit', description:'Edit a note with an audit trail', options:[noteId,option('text','Replacement content',true)] },
    { name:'remove', description:'Soft-delete a note', options:[noteId] },
  ] },
  { name:'config', description:'Guild configuration', category:'Configuration', permission:'admin', subcommands:[
    { name:'view', description:'Show configuration' },
    ...['logchannel','globalchannel'].map(name => ({ name, description:`Configure ${name}`, options:[option('value','Channel mention or ID; none to clear')] })),
  ] },
  { name:'help', description:'Command reference and examples', category:'Help', permission:'public' },
];
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
