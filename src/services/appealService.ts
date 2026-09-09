import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits as P,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Database } from '../database/client.js';
import type { AuditService } from './auditService.js';
import { embed, errorText, UserError } from '../utils/core.js';

export class AppealService {
  constructor(private db: Database, private audit: AuditService) {}

  async openModal(interaction: ButtonInteraction) {
    const caseId = this.caseId(interaction.customId);
    const record = await this.db.moderationCase.findUnique({ where: { id: caseId } });
    if (!record || !['BAN','GLOBAL_BAN','GLOBAL_TEMP_BAN'].includes(record.action)) {
      throw new UserError('That ban appeal is no longer available.');
    }
    if (record.userId !== interaction.user.id) throw new UserError('Only the banned user can submit this appeal.');
    const modal = new ModalBuilder().setCustomId(`appeal:submit:${caseId}`).setTitle('Ban Appeal');
    const input = (id: string, label: string, style = TextInputStyle.Short) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
        .setCustomId(id).setLabel(label).setStyle(style).setRequired(true).setMaxLength(1000));
    modal.addComponents(
      input('name','Name'),
      input('discordid','Discord ID'),
      input('banreason','Reason for ban',TextInputStyle.Paragraph),
      input('unbanreason','Why you believe you should be unbanned',TextInputStyle.Paragraph),
    );
    await interaction.showModal(modal);
  }

  async submit(interaction: ModalSubmitInteraction) {
    const caseId = this.caseId(interaction.customId);
    const record = await this.db.moderationCase.findUnique({ where: { id: caseId } });
    if (!record || !['BAN','GLOBAL_BAN','GLOBAL_TEMP_BAN'].includes(record.action)) {
      throw new UserError('That ban appeal is no longer available.');
    }
    if (record.userId !== interaction.user.id) throw new UserError('Only the banned user can submit this appeal.');
    const existing = await this.db.banAppeal.findUnique({ where: { caseId_userId: { caseId, userId: interaction.user.id } } });
    if (existing?.channelId) {
      await interaction.reply({ embeds: [embed('APPEAL', 'You already have an appeal submitted for this ban.')], flags: 64 });
      return;
    }
    const guild = await interaction.client.guilds.fetch(record.guildId);
    const config = await this.db.guildConfig.findUnique({ where: { guildId: record.guildId } });
    if (!config?.appealCategoryId) throw new UserError('This server has not configured an appeal category yet.');
    const appealRoles = await this.db.appealRole.findMany({ where: { guildId: record.guildId }, orderBy: { id: 'asc' } });
    if (!appealRoles.length) throw new UserError('This server has not configured any appeal staff roles yet.');
    const category = await guild.channels.fetch(config.appealCategoryId);
    if (category?.type !== ChannelType.GuildCategory) throw new UserError('The configured appeal category no longer exists.');
    const me = await guild.members.fetchMe();
    if (!category.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels, P.SendMessages, P.EmbedLinks])) {
      throw new UserError('The bot needs View Channel, Manage Channels, Send Messages and Embed Links in the appeal category.');
    }

    const name = interaction.fields.getTextInputValue('name').trim();
    const discordId = interaction.fields.getTextInputValue('discordid').trim();
    const banReason = interaction.fields.getTextInputValue('banreason').trim();
    const unbanReason = interaction.fields.getTextInputValue('unbanreason').trim();
    const channel = await guild.channels.create({
      name: `appeal-${interaction.user.username}-${caseId}`.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0, 90),
      type: ChannelType.GuildText,
      parent: category.id,
      reason: `Vengeful Enforcer appeal for ${interaction.user.id}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
        ...appealRoles.map(role => ({ id: role.roleId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })),
        { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels] },
      ],
    });
    await this.db.banAppeal.upsert({
      where: { caseId_userId: { caseId, userId: interaction.user.id } },
      create: { caseId, guildId: record.guildId, userId: interaction.user.id, channelId: channel.id, name, discordId, banReason, unbanReason },
      update: { channelId: channel.id, name, discordId, banReason, unbanReason, status: 'OPEN' },
    });
    await channel.send({ embeds: [embed('BAN APPEAL',
      `Name: ${name}\nDiscord ID: ${discordId}\nUser: <@${interaction.user.id}> (${interaction.user.id})\nOriginal reason: ${record.reason}\n\nReason for ban:\n${banReason}\n\nWhy you believe you should be unbanned:\n${unbanReason}`)], allowedMentions: { parse: [] } });
    await this.audit.log(record.guildId, interaction.user.id, 'BAN_APPEAL_OPENED', { caseId, channelId: channel.id }, interaction.user.id);
    await interaction.reply({ embeds: [embed('APPEAL', 'Your appeal has been submitted to the server staff.')], flags: 64 });
  }

  private caseId(customId: string) {
    const [, , raw] = customId.split(':');
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new UserError('Invalid appeal request.');
    return id;
  }
}
