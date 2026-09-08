import 'dotenv/config';
import { z } from 'zod';
const snowflake = z.string().regex(/^\d{17,20}$/);
export const env = z.object({
  DISCORD_TOKEN: z.string().min(1), CLIENT_ID: snowflake,
  CONTROL_GUILD_ID: snowflake, BOT_OWNER_ID: snowflake,
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  COMMAND_PREFIX: z.string().min(1).max(5).default('-'),
  COMMAND_GUILD_ID: z.preprocess(v => v === '' ? undefined : v, snowflake.optional()),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(15),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
}).parse(process.env);
