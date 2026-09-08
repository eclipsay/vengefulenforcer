import { REST, Routes } from 'discord.js';
import { env } from '../config/env.js';
import { slashDefinitions } from './definitions.js';
const route = env.COMMAND_GUILD_ID ? Routes.applicationGuildCommands(env.CLIENT_ID, env.COMMAND_GUILD_ID) : Routes.applicationCommands(env.CLIENT_ID);
await new REST({ version:'10' }).setToken(env.DISCORD_TOKEN).put(route, { body: slashDefinitions() });
console.log(`Registered Vengeful Enforcer commands ${env.COMMAND_GUILD_ID ? `in guild ${env.COMMAND_GUILD_ID}` : 'globally'}.`);
