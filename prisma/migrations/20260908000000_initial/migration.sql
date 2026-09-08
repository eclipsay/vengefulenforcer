-- CreateTable
CREATE TABLE "UserRecord" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" SERIAL NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "moderatorId" TEXT NOT NULL,
    "moderatorName" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'LOCAL',
    "reason" TEXT NOT NULL,
    "duration" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNote" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "moderatorName" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseComment" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEvidence" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAuditLog" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "editorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "guildId" TEXT NOT NULL,
    "logChannelId" TEXT,
    "moderatorRoleId" TEXT,
    "adminRoleId" TEXT,
    "shareNotes" BOOLEAN NOT NULL DEFAULT false,
    "globalBans" BOOLEAN NOT NULL DEFAULT true,
    "autoEnforce" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "EnforcementGuild" (
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registeredBy" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "EnforcementGuild_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "GlobalModerator" (
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalModerator_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GlobalBan" (
    "userId" TEXT NOT NULL,
    "caseId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GlobalBan_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GlobalBanExecution" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalBanExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtectedUser" (
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtectedUser_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ModeratorAction" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModeratorAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelLock" (
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "previous" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelLock_pkey" PRIMARY KEY ("channelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationCase_requestId_key" ON "ModerationCase"("requestId");

-- CreateIndex
CREATE INDEX "ModerationCase_userId_guildId_createdAt_idx" ON "ModerationCase"("userId", "guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_scope_status_action_idx" ON "ModerationCase"("scope", "status", "action");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_caseId_userId_key" ON "Notification"("caseId", "userId");

-- CreateIndex
CREATE INDEX "UserNote_userId_guildId_idx" ON "UserNote"("userId", "guildId");

-- CreateIndex
CREATE INDEX "GlobalBan_active_idx" ON "GlobalBan"("active");

-- CreateIndex
CREATE INDEX "GlobalBanExecution_caseId_guildId_idx" ON "GlobalBanExecution"("caseId", "guildId");

-- CreateIndex
CREATE INDEX "GlobalBanExecution_status_action_idx" ON "GlobalBanExecution"("status", "action");

-- CreateIndex
CREATE INDEX "ModeratorAction_userId_createdAt_idx" ON "ModeratorAction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNote" ADD CONSTRAINT "UserNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseComment" ADD CONSTRAINT "CaseComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvidence" ADD CONSTRAINT "CaseEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAuditLog" ADD CONSTRAINT "CaseAuditLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalBan" ADD CONSTRAINT "GlobalBan_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalBanExecution" ADD CONSTRAINT "GlobalBanExecution_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
