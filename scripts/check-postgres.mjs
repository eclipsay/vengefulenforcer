// Disposable PostgreSQL integration smoke check, also run by CI after migrations.
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url = new URL(process.env.DATABASE_URL ?? '');
if (!url.pathname.endsWith('/vengeful_test')) throw new Error('This check requires a disposable database named vengeful_test.');
let db = new PrismaClient();
const requestId = randomUUID();
try {
  const record = await db.$transaction(async tx => {
    await tx.userRecord.upsert({where:{id:'123456789012345678'},create:{id:'123456789012345678',username:'Integration subject'},update:{}});
    const c = await tx.moderationCase.create({data:{requestId,userId:'123456789012345678',moderatorId:'staff',moderatorName:'Staff',guildId:'guild',guildName:'Test',action:'WARN',reason:'Persistent warning',status:'SUCCESS'}});
    await tx.notification.create({data:{caseId:c.id,userId:c.userId,status:'FAILED',error:'DM closed'}});
    await tx.userNote.create({data:{userId:c.userId,moderatorId:'staff',moderatorName:'Staff',guildId:'guild',content:'Persistent note'}});
    return c;
  });
  await db.$disconnect();
  db = new PrismaClient();
  const recovered = await db.moderationCase.findUniqueOrThrow({where:{requestId},include:{notifications:true}});
  assert.equal(recovered.id,record.id);
  assert.equal(recovered.reason,'Persistent warning');
  assert.equal(recovered.notifications[0].status,'FAILED');
  await assert.rejects(db.moderationCase.create({data:{requestId,userId:record.userId,moderatorId:'staff',moderatorName:'Staff',guildId:'guild',guildName:'Test',action:'WARN',reason:'Duplicate'}}));
  console.log('PostgreSQL / Prisma transaction, reconnection, notification and uniqueness checks passed.');
} finally { await db.$disconnect(); }
