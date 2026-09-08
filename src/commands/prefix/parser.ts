import { definitions, type Definition } from '../definitions.js';
import { UserError } from '../../utils/core.js';
export interface Invocation { definition: Definition; sub?: string; args: Record<string,string> }
export function parsePrefix(content: string, prefix: string): Invocation | null {
  if (!content.startsWith(prefix)) return null;
  const tokens = content.slice(prefix.length).trim().split(/\s+/);
  const name = tokens.shift()?.toLowerCase();
  const definition = definitions.find(d => d.name === name || d.aliases?.includes(name ?? ''));
  if (!definition) return null;
  let sub: string | undefined;
  if (definition.subcommands) {
    sub = tokens.shift()?.toLowerCase() ?? ({ config:'view' } as Record<string,string>)[definition.name];
    if (!definition.subcommands.some(s => s.name === sub)) throw new UserError(`Use ${prefix}${definition.name} ${definition.subcommands.map(s => s.name).join('|')}.`);
  }
  const options = definition.subcommands?.find(s => s.name === sub)?.options ?? definition.options ?? [];
  const args: Record<string,string> = {};
  if (definition.name === 'globalban') {
    const index = tokens.indexOf('--evidence');
    if (index >= 0) {
      if (index !== tokens.length - 2) throw new UserError('Place --evidence URL at the end of the command.');
      args.evidence = tokens[index + 1]; tokens.splice(index,2);
    }
  }
  for (const o of options) {
    if (args[o.name]) continue;
    const value = o.rest ? tokens.splice(0).join(' ') : tokens.shift();
    if (!value && o.required !== false) throw new UserError(`Missing ${o.name}. See ${prefix}help for syntax.`);
    if (value) args[o.name] = value;
  }
  if (tokens.length) throw new UserError('Too many arguments. See help for syntax.');
  return { definition, sub, args };
}
