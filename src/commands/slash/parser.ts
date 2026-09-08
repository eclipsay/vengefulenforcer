import type { ChatInputCommandInteraction } from 'discord.js';
import { definitions } from '../definitions.js';
import type { Invocation } from '../prefix/parser.js';
export function parseSlash(interaction: ChatInputCommandInteraction): Invocation | null {
  const definition = definitions.find(d => d.name === interaction.commandName);
  if (!definition) return null;
  const sub = interaction.options.getSubcommand(false) ?? undefined;
  const options = definition.subcommands?.find(s => s.name === sub)?.options ?? definition.options ?? [];
  const args: Record<string,string> = {};
  for (const o of options) { const value = interaction.options.getString(o.name); if (value) args[o.name] = value; }
  return { definition, sub, args };
}
