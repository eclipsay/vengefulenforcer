ALTER TABLE "GuildConfig" ADD COLUMN "appealCategoryId" TEXT;

ALTER TABLE "GlobalBan" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE TABLE "BanAppeal" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "name" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "banReason" TEXT NOT NULL,
    "unbanReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BanAppeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppealRole" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppealRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BanAppeal_caseId_userId_key" ON "BanAppeal"("caseId", "userId");

CREATE INDEX "BanAppeal_guildId_status_idx" ON "BanAppeal"("guildId", "status");

CREATE UNIQUE INDEX "AppealRole_guildId_roleId_key" ON "AppealRole"("guildId", "roleId");

CREATE INDEX "AppealRole_guildId_idx" ON "AppealRole"("guildId");

CREATE INDEX "GlobalBan_expiresAt_idx" ON "GlobalBan"("expiresAt");

ALTER TABLE "BanAppeal" ADD CONSTRAINT "BanAppeal_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
