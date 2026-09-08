import type { Guild, GuildMember, Message, MessageCreateOptions } from 'discord.js';
export interface Context {
  guild: Guild;
  member: GuildMember;
  channelId: string;
  requestId: string;
  reply: (payload: MessageCreateOptions) => Promise<Message>;
}
