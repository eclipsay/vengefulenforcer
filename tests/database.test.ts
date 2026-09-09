import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';

describe('PostgreSQL migration and durable records',()=> {
  let db:PGlite, directory:string;
  beforeAll(async()=> {
    directory=await mkdtemp(join(tmpdir(),'vengeful-db-test-'));
    db=new PGlite(directory);
    await db.exec(await readFile(new URL('../prisma/migrations/20260908000000_initial/migration.sql',import.meta.url),'utf8'));
    await db.exec(`INSERT INTO "UserRecord" (id,username,"updatedAt") VALUES ('123456789012345678','TestSubject',NOW());
      INSERT INTO "ModerationCase" ("requestId","userId","moderatorId","moderatorName","guildId","guildName",action,reason,status,"updatedAt")
      VALUES ('warning-request','123456789012345678','staff','Moderator','guild','Test Guild','WARN','Repeated spam','SUCCESS',NOW());
      INSERT INTO "UserNote" ("userId","moderatorId","moderatorName","guildId",content,"updatedAt")
      VALUES ('123456789012345678','staff','Moderator','guild','Persistent note',NOW());
      INSERT INTO "GlobalBan" ("userId","caseId",reason,"moderatorId") VALUES ('123456789012345678',1,'Spam','staff');
      INSERT INTO "EnforcementGuild" ("guildId",name,"registeredBy") VALUES ('guild','Test Guild','staff');
      INSERT INTO "Notification" ("caseId","userId",status,"updatedAt") VALUES (1,'123456789012345678','FAILED',NOW());`);
  },30000);
  afterAll(async()=> {
    await db?.close();
    if (directory) {
      const root=resolve(tmpdir()),target=resolve(directory);
      if (!target.startsWith(root+sep) || !target.slice(root.length+1).startsWith('vengeful-db-test-')) throw new Error('Unsafe test cleanup path');
      await rm(target,{recursive:true,force:true});
    }
  });
  it('retains warnings, notes, global bans, registry and delivery status across engine restart',async()=> {
    await db.exec(await readFile(new URL('../prisma/migrations/20260908010000_simple_channels/migration.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../prisma/migrations/20260908020000_appeals_and_temp_bans/migration.sql',import.meta.url),'utf8'));
    await db.exec(`INSERT INTO "GuildConfig" ("guildId","globalCommandChannelId","appealCategoryId","appealUrl","updatedAt") VALUES ('guild','commands','appeals','https://forms.gle/appeal',NOW());
      UPDATE "GlobalBan" SET "expiresAt"=NOW() + INTERVAL '7 days';
      INSERT INTO "BanAppeal" ("caseId","guildId","userId","name","discordId","banReason","unbanReason","updatedAt")
      VALUES (1,'guild','123456789012345678','TestSubject','123456789012345678','Spam','I understand the rule now.',NOW());
      INSERT INTO "AppealRole" ("guildId","roleId","addedBy") VALUES ('guild','appeal-role','staff');`);
    await db.close();db=new PGlite(directory);await db.waitReady;
    const result=await db.query<any>('SELECT action,status FROM "ModerationCase"');
    expect(result.rows).toEqual([{action:'WARN',status:'SUCCESS'}]);
    expect((await db.query<any>('SELECT content FROM "UserNote"')).rows[0].content).toBe('Persistent note');
    expect((await db.query<any>('SELECT active FROM "GlobalBan"')).rows[0].active).toBe(true);
    expect((await db.query<any>('SELECT name FROM "EnforcementGuild"')).rows[0].name).toBe('Test Guild');
    expect((await db.query<any>('SELECT status FROM "Notification"')).rows[0].status).toBe('FAILED');
    expect((await db.query<any>('SELECT "globalCommandChannelId" FROM "GuildConfig"')).rows[0].globalCommandChannelId).toBe('commands');
    expect((await db.query<any>('SELECT "appealCategoryId" FROM "GuildConfig"')).rows[0].appealCategoryId).toBe('appeals');
    expect((await db.query<any>('SELECT "appealUrl" FROM "GuildConfig"')).rows[0].appealUrl).toBe('https://forms.gle/appeal');
    expect((await db.query<any>('SELECT name FROM "BanAppeal"')).rows[0].name).toBe('TestSubject');
    expect((await db.query<any>('SELECT "roleId" FROM "AppealRole"')).rows[0].roleId).toBe('appeal-role');
    expect((await db.query<any>('SELECT "expiresAt" IS NOT NULL AS expires FROM "GlobalBan"')).rows[0].expires).toBe(true);
  },30000);
  it('rejects duplicate request IDs and duplicate notifications',async()=> {
    await expect(db.exec(`INSERT INTO "ModerationCase" ("requestId","userId","moderatorId","moderatorName","guildId","guildName",action,reason,"updatedAt") VALUES ('warning-request','123456789012345678','staff','Moderator','guild','Guild','WARN','Duplicate',NOW())`)).rejects.toThrow(/unique/i);
    await expect(db.exec(`INSERT INTO "Notification" ("caseId","userId","updatedAt") VALUES (1,'123456789012345678',NOW())`)).rejects.toThrow(/unique/i);
  });
  it('rolls back a case and registry mutation together',async()=> {
    await expect(db.transaction(async tx=> {
      await tx.exec(`UPDATE "GlobalBan" SET active=false; UPDATE "ModerationCase" SET reason='Should roll back';`);
      throw new Error('Simulated transaction failure');
    })).rejects.toThrow();
    expect((await db.query<any>('SELECT active FROM "GlobalBan"')).rows[0].active).toBe(true);
    expect((await db.query<any>('SELECT reason FROM "ModerationCase"')).rows[0].reason).toBe('Repeated spam');
  });
  it('preserves foreign keys and allocates distinct permanent case numbers',async()=> {
    await expect(db.exec(`DELETE FROM "ModerationCase" WHERE id=1`)).rejects.toThrow(/foreign key/i);
    const result=await db.query<any>(`INSERT INTO "ModerationCase" ("requestId","userId","moderatorId","moderatorName","guildId","guildName",action,reason,"updatedAt") VALUES ('new-request','123456789012345678','staff','Moderator','guild','Guild','BAN','Spam',NOW()) RETURNING id`);
    expect(result.rows[0].id).toBeGreaterThan(1);
  });
});
