import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, type EmbedBuilder } from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { Context } from '../types/context.js';
import { embed, errorText, UserError } from '../utils/core.js';

export async function paginate(ctx: Context, load: (page: number) => Promise<{ pages: number; embed: EmbedBuilder }>) {
  let page = 0;
  const key = randomUUID();
  const row = (pages: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${key}:prev`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`${key}:next`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page + 1 >= pages));
  let data = await load(page);
  const message = await ctx.reply({ embeds: [data.embed], components: data.pages > 1 ? [row(data.pages)] : [] });
  if (data.pages <= 1) return;
  let busy = false;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
  collector.on('collect', interaction => { void (async () => {
    if (interaction.user.id !== ctx.member.id) { await interaction.reply({ content: 'Run the command yourself to view these records.', flags: 64 }); return; }
    await interaction.deferUpdate();
    if (busy) return;
    busy = true;
    try {
      const next = Math.max(0, Math.min(data.pages - 1, page + (interaction.customId.endsWith(':next') ? 1 : -1)));
      data = await load(next); page = Math.min(next, data.pages - 1);
      if (page !== next) data = await load(page);
      await interaction.editReply({ embeds: [data.embed], components: [row(data.pages)] });
    } catch (err) {
      collector.stop();
      await interaction.editReply({ embeds: [embed('ERROR', err instanceof UserError ? err.message : 'Unable to load records.')], components: [] });
    } finally { busy = false; }
  })().catch(() => collector.stop()); });
  collector.on('end', () => { void message.edit({ components: [] }).catch(() => {}); });
}

export async function confirm(ctx: Context, description: string, execute: () => Promise<string>) {
  const key = randomUUID();
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${key}:yes`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${key}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
  const message = await ctx.reply({ embeds: [embed('CONFIRM GLOBAL ENFORCEMENT', description)], components: [row] });
  let claimed = false;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
  collector.on('collect', interaction => { void (async () => {
    if (interaction.user.id !== ctx.member.id) { await interaction.reply({ content: 'Only the issuing moderator can confirm this action.', flags: 64 }); return; }
    await interaction.deferUpdate();
    if (claimed) return;
    claimed = true; collector.stop('claimed');
    if (interaction.customId.endsWith(':no')) { await interaction.editReply({ embeds: [embed('CANCELLED', 'No action was taken.')], components: [] }); return; }
    await interaction.editReply({ embeds: [embed('ENFORCEMENT', 'Processing. Results are saved in the database.')], components: [] });
    try {
      const result = await execute();
      await message.edit({ embeds: [embed('ENFORCEMENT RESULT', result)], components: [] });
    } catch (err) {
      await message.edit({ embeds: [embed('ERROR', err instanceof UserError ? err.message : 'The operation was interrupted. Check case history before retrying.')], components: [] });
      if (!(err instanceof UserError)) process.stderr.write(`Global confirmation error: ${errorText(err)}\n`);
    }
  })().catch(() => collector.stop()); });
  collector.on('end', (_items, reason) => {
    if (reason !== 'claimed') void message.edit({ embeds: [embed('EXPIRED', 'Confirmation expired. Run the command again.')], components: [] }).catch(() => {});
  });
}
