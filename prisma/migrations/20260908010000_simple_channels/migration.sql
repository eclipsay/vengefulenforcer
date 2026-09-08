-- Add channel configuration without deleting any existing moderation data.
ALTER TABLE "GuildConfig" ADD COLUMN "globalCommandChannelId" TEXT;
