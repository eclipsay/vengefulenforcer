import { Client, Events, GatewayIntentBits } from 'discord.js';
import pg from 'pg';
import pino from 'pino';
import { env } from './config/env.js';
import { db } from './database/client.js';
import { createServices } from './services/index.js';
import { attachEvents } from './events/index.js';

const logger=pino({ level:env.LOG_LEVEL,redact:['token','password','DISCORD_TOKEN','DATABASE_URL'] });
const client=new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildModeration,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],
  allowedMentions:{parse:[],repliedUser:false},rest:{timeout:15000,retries:2} });
const services=createServices(db,client,logger,env);
const events=attachEvents(client,services,logger,env.COMMAND_PREFIX);
const lockUrl=new URL(env.DATABASE_URL); lockUrl.searchParams.delete('schema');
const lock=new pg.Client({ connectionString:lockUrl.toString() });
let interval:NodeJS.Timeout|undefined;
let shuttingDown=false;
async function shutdown(code=0) {
  if (shuttingDown) return; shuttingDown=true; events.stop();
  if (interval) clearInterval(interval);
  const deadline=setTimeout(()=>process.exit(1),25000); deadline.unref();
  await services.queue.drain();
  client.destroy();
  await db.$disconnect(); await lock.end();
  process.exit(code);
}
lock.on('error',err=> { logger.fatal({err},'Database singleton lock lost'); events.stop(); client.destroy(); process.exit(1); });
process.on('SIGINT',()=>void shutdown()); process.on('SIGTERM',()=>void shutdown());
process.on('unhandledRejection',err=>{ logger.fatal({err},'Unhandled rejection'); void shutdown(1); });
try {
  await db.$connect(); await lock.connect();
  const result=await lock.query('SELECT pg_try_advisory_lock($1, $2) AS acquired',[8675309,1701]);
  if (!result.rows[0].acquired) throw new Error('Another Vengeful Enforcer process is already running against this database.');
  // Never automatically repeat non-idempotent local actions or DMs after an ambiguous crash.
  await db.moderationCase.updateMany({ where:{ scope:'LOCAL',status:'PENDING' },data:{ status:'UNKNOWN',error:'Process interrupted; verify Discord state before retrying.' } });
  await db.notification.updateMany({ where:{ status:'PENDING' },data:{ status:'UNKNOWN',error:'Process interrupted during DM delivery; not resent to avoid duplicates.' } });
  client.once(Events.ClientReady,()=>{ void (async()=> {
    if (client.user!.id !== env.CLIENT_ID) throw new Error('CLIENT_ID does not match the logged-in bot.');
    for (const guild of client.guilds.cache.values()) {
      await db.guildConfig.upsert({ where:{ guildId:guild.id },create:{guildId:guild.id},update:{} });
    }
    await services.queue.run(()=>services.sync.run());
    events.start();
    let syncing=false;
    interval=setInterval(()=> {
      if (syncing || shuttingDown) return; syncing=true;
      void services.queue.run(()=>services.sync.run()).catch(err=>logger.error({err},'Scheduled sync failed')).finally(()=>{ syncing=false; });
    },env.SYNC_INTERVAL_MINUTES*60000);
    logger.info({ guilds:client.guilds.cache.size },'Vengeful Enforcer is ready');
  })().catch(err=>{ logger.fatal({err},'Startup recovery failed'); void shutdown(1); }); });
  await client.login(env.DISCORD_TOKEN);
} catch (err) { logger.fatal({err},'Startup failed'); await shutdown(1); }
