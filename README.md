# Vengeful Enforcer

A Discord moderation bot with `-` prefix commands, matching slash commands, permanent PostgreSQL records, and a centrally administered enforcement network. Node.js, TypeScript, discord.js 14, and Prisma 6.

Warnings create permanent cases and send the subject a DM containing the server, reason, date, and case number. Local and global bans attempt a DM **before** enforcement, while the bot may still share a server with the subject. Closed DMs do not stop the punishment. Delivery outcomes remain visible in the case. Global synchronization never sends repeated ban notices.

## Quick start

1. Install Node.js 24 LTS and PostgreSQL 16 or newer. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.
2. Create a Discord application at <https://discord.com/developers/applications>. Name the application and bot **Vengeful Enforcer**. Copy the Application ID and generate the bot token. Keep the token private.
3. On the **Bot** page, enable **Server Members Intent** and **Message Content Intent**. These are required for join enforcement and prefix commands. The bot also requests Guilds, Guild Moderation and Guild Messages intents. Presence intent is not needed.
4. In the OAuth2 URL Generator select `bot` and `applications.commands`. Invite it into the Control Server and each faction server with: View Channels, Send Messages, Embed Links, Read Message History, Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Channels, and Manage Roles. View Audit Log is recommended for attributing manual unbans. Manage Roles is needed to edit channel permission overwrites. Administrator is not required.
5. Move the bot's role above the roles it will moderate. Discord still prevents the bot from punishing server owners or members above it.
6. Enable Developer Mode in Discord and copy the Control Server ID and your own user ID.
7. Create a dedicated database and role, for example in `psql` as a database administrator:

   ```sql
   CREATE USER vengeful WITH PASSWORD 'replace-with-a-strong-password';
   CREATE DATABASE vengeful OWNER vengeful;
   ```

8. Copy `.env.example` to `.env`, then fill every required value. URL-encode special characters in the database connection password.

   ```dotenv
   DISCORD_TOKEN=your-bot-token
   CLIENT_ID=your-application-id
   CONTROL_GUILD_ID=your-control-server-id
   BOT_OWNER_ID=your-discord-user-id
   DATABASE_URL=postgresql://vengeful:password@localhost:5432/vengeful?schema=public
   COMMAND_PREFIX=-
   SYNC_INTERVAL_MINUTES=15
   ```

9. Install, migrate, build, register commands, and start:

   ```sh
   npm ci
   npm run prisma:migrate
   npm run build
   npm run register-commands
   npm start
   ```

   `npm ci` generates the Prisma client. `npm run prisma:generate` regenerates it explicitly. `npm run dev` runs TypeScript with restart-on-change. `npm run deploy` runs migrations, build and command registration; start the bot afterward with your service manager. Do not register commands on every Gateway reconnect.

10. In the Control Server, register each participating guild and configure logging:

    ```text
    -enforcement add 123456789012345678
    -servers
    -config logchannel #enforcement-logs
    -globalmods add 123456789012345678 ADMIN
    -sync bans
    ```

    Run `-config logchannel #logs`, `-config modrole @Moderator` and `-config adminrole @Administrator` in each faction server. An invite by itself never registers or enables enforcement. Removed servers retain their past records and bans. Reinviting a previously removed bot requires explicit registration/enabling.

## Commands

Every command below has a slash equivalent. Slash user arguments are **strings** so IDs of users outside the guild work; enter a raw ID or mention. Prefix reasons and note text consume the remainder of the command, so quotes are unnecessary. `-help` provides a paginated command reference. Prefix command output is visible in its channel; use a private staff channel. Slash responses are ephemeral.

| Command | Behavior |
| --- | --- |
| `-warn <user/id> <reason>` | Save a warning case and attempt a DM |
| `-warnings <user/id>` | Paginated warning cases |
| `-ban <user/id> <reason>` | Notify, then ban locally |
| `-unban <user/id> <reason>` | Remove a local ban; active global bans must be revoked centrally |
| `-kick <user/id> <reason>` | Kick a current member |
| `-timeout <user/id> <30m/1h/7d> <reason>` | Timeout a current member; maximum 28 days |
| `-untimeout <user/id> <reason>` | Remove a timeout |
| `-clear <1–100>` | Delete recent messages; skip messages older than 14 days |
| `-slowmode <0–21600>` | Set slowmode seconds in the current text channel |
| `-lock` / `-unlock` | Deny @everyone Send Messages, then restore the saved previous value |
| `-globalban <user/id> <reason> [--evidence URL]` | Confirm, store a global ban, notify once, enforce in enabled guilds |
| `-globalunban <user/id> <reason>` | Revoke the database ban and attempt unbans in currently enabled enforcement guilds |
| `-history <user/id>` | Paginated cases, counts and global status |
| `-note add <user/id> <text>` | Save a staff note |
| `-note list <user/id>` | Notes with warning/ban context |
| `-note edit <note_id> <text>` | Edit and retain the previous content in the audit trail |
| `-note remove <note_id>` | Soft-delete a note; preserve history |
| `-case VE-000003` | View reason, duration, status, DMs, evidence, comments, edits and execution attempts |
| `-case edit VE-000003 reason <new reason>` | Update reason with old/new audit values |
| `-case comment VE-000003 <text>` | Add a permanent moderator comment |
| `-case evidence VE-000003 <URL>` | Add evidence without removing previous evidence |
| `-config` | Show the current guild's configuration |
| `-config logchannel <#channel/id/none>` | Configure audit delivery |
| `-config modrole <@role/id/none>` | Delegate local moderation |
| `-config adminrole <@role/id/none>` | Delegate guild configuration and moderation |
| `-config notes <on/off>` | Opt into shared notes; default off |
| `-config globalbans <on/off>` | Opt in/out of global punishments in a registered guild |
| `-config autoenforce <on/off>` | Control immediate re-ban after a manual unban |
| `-enforcement add/remove/enable/disable <guild_id>` | Manage network membership and enforcement |
| `-enforcement list` / `-servers` / `-network` | Paginated registered server list |
| `-enforcement info <guild_id>` / `-serverinfo <guild_id>` | Guild registration and configuration |
| `-globalmods add <user/id> <ADMIN/MODERATOR>` | Bot owner grants persistent global staff permissions |
| `-globalmods remove <user/id>` / `-globalmods list` | Revoke/list explicit staff grants |
| `-permissions …` | Equivalent to `globalmods`, including slash command |
| `-protected add <user/id> <reason>` | Protect against new global bans |
| `-protected remove <user/id>` / `-protected list` | Remove/list protections |
| `-sync bans` | Restore missing global bans and retry unfinished revocations |

Slash forms use subcommands where appropriate: `/case view id:VE-000003`, `/config view`, `/note add user:ID text:…`, `/globalban user:ID reason:… evidence:URL`, `/sync bans`. Prefix aliases: `gban`, `gb`, `gunban`, `hist`, and `record`.

Warnings are informational; there are no automatic escalating punishments. To correct a warning, edit its reason or add a case comment. Warning records are never silently deleted. Warning/ban DMs omit private evidence and internal staff notes. DMs are best effort: Discord can reject them, especially if no server is shared. A pre-ban notice states that enforcement is about to be attempted, because the API may still reject the ban.

## Permissions and visibility

- All global and network commands run **only in `CONTROL_GUILD_ID`**. Control Server members with Discord **Ban Members** can use `globalban` and `globalunban`. An explicit `MODERATOR` grant also allows these commands.
- Control Server Discord administrators, its configured administrator role, explicit global `ADMIN` users, and `BOT_OWNER_ID` can administer the enforcement network, protected IDs and synchronization. Only `BOT_OWNER_ID` can grant/revoke explicit global staff roles. The owner must be a member of the Control Server.
- Protected users may only be newly globally banned by `BOT_OWNER_ID`. Adding protection does not revoke an existing ban. The bot owner is implicitly protected; Discord hierarchy restrictions still apply.
- Local actions require the corresponding Discord permission or a configured moderator/administrator role. Guild configuration requires local administration. Staff are checked against their **current** guild membership and roles, including when confirming a global ban.
- Local target checks prevent self-punishment, punishment of the bot/server owner, and punishment of equal/higher roles. Discord also enforces the bot's permissions and hierarchy in each destination guild.
- Local cases are visible in their originating guild; global cases are available to local staff. Notes are shared only when **both** guilds opt in and are active registered participants. Shared notes can only be modified in their originating guild.
- Confirmation expires after 60 seconds and can only be consumed once by its issuer. Pagination expires after five minutes and is restricted to its issuer, with access rechecked on navigation. There is a two-second per-user/per-guild command cooldown.

## Persistence, recovery and operational behavior

PostgreSQL is authoritative. The included migration creates user records, cases, notes, comments, evidence, case edit audits, configurations, enforcement registry, global staff grants, global bans, per-guild execution results, protected users, moderator audit events, DM outcomes and saved channel lock state. Cases use the database sequence for `VE-000001` numbering; gaps after rolled-back transactions are normal.

Case creation, global-ban activation/revocation and initial per-server jobs are transactional. Discord request IDs prevent duplicate cases when the same command is processed again. Failed Discord guild operations do not stop subsequent guilds. REST work is serialized and discord.js manages API rate-limit buckets; idempotent operations also retry transient server/network failures. Execution failures and retry rows remain in PostgreSQL.

Startup reconnects to the database, verifies the Control Server and registered guilds, reloads active global bans, retries unfinished global work and synchronizes missing bans without creating new cases. Scheduled synchronization runs every 15 minutes by default. Joining globally banned users are re-banned in enabled guilds; disabled registered guilds receive log warnings instead. Manual unbans are logged and immediately reversed when `autoenforce` is on. Attribution is best effort from recent matching Discord audit entries; unavailable actors are marked unknown.

`autoenforce off` disables only immediate manual-unban reversal. Periodic/manual synchronization still restores bans when `globalbans on`; use `globalbans off` or disable/remove the registry entry to stop enforcement. Global unban only operates on currently enabled participating guilds. It does not clean up removed/disabled guilds. Those may need separate local unbans. Removing a guild never triggers mass unbans; `--cleanup` is deliberately unsupported.

A dedicated PostgreSQL advisory lock permits **one active bot process per database**. Use a direct PostgreSQL connection or session-mode pooler; transaction-mode poolers are unsuitable for this lock. This implementation is a single Gateway process, not a sharded fleet. If the singleton connection is lost, the process exits so another instance can safely recover. SIGINT/SIGTERM stop new commands, drain work for up to 25 seconds, and close clients; a service manager should restart abnormal exits.

Discord and PostgreSQL cannot participate in one transaction. If the process stops at an ambiguous point, pending local cases and DM sends become `UNKNOWN`; staff must inspect Discord before repeating local actions. Global actions are idempotently reconciled. Existing DM attempts are not resent during recovery, avoiding repeated notices. A crash after a global case is saved but before any DM attempt is recorded can still trigger its first notice before recovered enforcement. A saved channel-lock intent can be reversed with `unlock` after an interrupted request. Explicit role/member Send Messages allows and administrators can bypass an @everyone lock; this command does not rewrite every role overwrite.

Configure a logging channel in **every guild**, including Control, to receive Discord audit embeds. Database cases/audits/execution rows remain available when log-channel delivery fails. Logs and records may contain sensitive moderation information: restrict database and staff channel access, use TLS for remote PostgreSQL, and make regular `pg_dump` backups with tested restores. Do not remove the Docker database volume or reset migrations to restart the bot.

## VPS deployment with an existing PM2 list

Use the same Linux account and `PM2_HOME` that own your existing PM2 applications. Start by running `pm2 list` and checking that your current apps appear. Keep the existing PM2 installation and startup service. The included `ecosystem.config.cjs` adds one process named `vengeful-enforcer`, uses fork mode, and allows 30 seconds for shutdown. Do not run this bot in cluster mode or multiple instances.

Upload the project to a separate directory such as `~/apps/vengeful-enforcer`, including the ecosystem file, source, Prisma migrations, package files and lockfile. Exclude `node_modules`, `dist`, `.git`, and local `.env`; install dependencies on the VPS and create its own `.env`. If the code has been pushed to your repository, cloning it into this directory is another option.

Use Node.js 22.12+ (Node 24 recommended). If your existing apps need an older system Node, install a separate Node runtime for this bot instead of replacing theirs. Run build/registration commands with the new runtime available in your shell and set `VE_NODE_BINARY` to its absolute executable path when starting PM2.

Configure a dedicated PostgreSQL database, `.env`, Discord intents and bot invite as described in Quick start. Then, from the bot directory:

```sh
npm ci --include=dev
npm run prisma:migrate
npm run build
npm run register-commands
VE_NODE_BINARY="$(command -v node)" pm2 start ecosystem.config.cjs --only vengeful-enforcer
pm2 logs vengeful-enforcer --lines 50
```

Exit the log viewer with Ctrl+C; this does not stop the bot. Verify `Vengeful Enforcer is ready` and check `pm2 list` to confirm the existing apps and new bot are online. Then run `pm2 save` to save the whole current list for reboot recovery. If PM2 boot startup is not already configured, run `pm2 startup` as that same account and execute the specific privileged command it prints. There is no need to restart the other applications or reboot the VPS.

For an update, upload the changed files while preserving `.env`. Build before stopping the current bot. For additive migrations compatible with the running release:

```sh
npm ci --include=dev
npm run prisma:migrate
npm run build
npm run register-commands
pm2 restart vengeful-enforcer
pm2 logs vengeful-enforcer --lines 50
```

Coordinate a bot-only maintenance window for future incompatible schema changes. To manage this bot, target its name: `pm2 restart vengeful-enforcer`, `pm2 stop vengeful-enforcer`, or `pm2 logs vengeful-enforcer`. Avoid `pm2 restart all`, `pm2 stop all`, `pm2 delete all`, or `pm2 kill`, which affect other applications. A different Linux user or `sudo pm2` can select a different PM2 list; stay in your established PM2 account.

The bot connects outbound to Discord and needs no public HTTP port, domain, or reverse proxy. A local PostgreSQL instance can stay accessible only on localhost. Official PM2 references: [ecosystem configuration](https://pm2.keymetrics.io/docs/usage/application-declaration/), [startup and saved processes](https://pm2.keymetrics.io/docs/usage/startup/).

## Docker deployment

Fill `.env` as above and add `POSTGRES_PASSWORD` with a strong URL-safe password (for example a long random hex string). The Compose configuration supplies the internal `db` hostname to the bot and migration service.

```sh
docker compose up --build -d
docker compose logs -f bot
```

Compose starts PostgreSQL with a persistent named volume, applies migrations, registers slash commands, then starts the bot as a non-root user. The runtime image omits development dependencies. One-shot migration/registration services use the build stage. No database port is published. `docker compose down` retains data; do not use `down -v` unless intentionally destroying the database. Docker deployment has not been executed as part of local unit verification.

## Validation and test-server checklist

```sh
npm run check
npm run build
npm audit --audit-level=high
```

`check` needs a syntactically valid `DATABASE_URL` for Prisma validation but does not connect to that database. Automated tests cover shared command parsing, permissions, role hierarchy, warning persistence before notification, blocked DMs, pre-ban notices, duplicate requests, per-guild failure isolation, opt-outs, recovery, record visibility, and confirmation ownership/cancellation/expiry. Migration tests run the actual SQL in PGlite's PostgreSQL engine, close/reopen the database and verify persistence, transaction rollback, foreign keys and uniqueness. PGlite is only a development test dependency; the bot uses Prisma and PostgreSQL.

CI also runs the migrations against a PostgreSQL 17 service and `node scripts/check-postgres.mjs` to exercise Prisma transactions and client reconnection. That script requires a disposable database named `vengeful_test` and leaves its test records there. Real Discord API behavior requires a controlled test deployment:

1. Set optional `COMMAND_GUILD_ID` to a private test/control guild for fast slash registration. Omit it for production global registration. Guild-scoped test commands remain registered until removed through Discord's API; avoid leaving duplicate test/global registrations.
2. Register two test faction guilds. Keep a third invited but unregistered. Set log channels and place the bot role above the test account.
3. Run prefix and slash warnings. Check the subject's DM, `warnings`, `history`, and `case`. Repeat with DMs disabled: the warning must still succeed with `DM: FAILED`.
4. Test local bans and confirm the DM is attempted before removal. Test a hierarchy/permission failure and inspect the failed case.
5. Test global confirmation with the issuer and a second moderator, then cancel once. Confirm a fresh global ban; verify only enabled registered guilds are affected.
6. Restart the bot. Confirm cases, notes and the active global ban remain. Manually remove a ban and test join enforcement and `-sync bans`.
7. Remove Ban Members in one destination and confirm other guilds still receive bans and the failed execution remains visible. Restore permission and synchronize.
8. Revoke the global ban. Verify the original case remains and a new unban case exists. Test notes sharing off/on and visibility from unrelated guilds.

Live login, command registration and enforcement require your credentials and actual test guilds; local tests do not claim to verify those external operations.

## Architecture

`src/commands/definitions.ts` describes names, aliases, permissions and arguments. `prefix/parser.ts` and `slash/parser.ts` normalize inputs into the same invocation. `registry.ts` dispatches into the shared services. `ui.ts` handles confirmation and pagination. `events/index.ts` wires Gateway events. Services separate local moderation, notifications, global bans, synchronization, cases, records, channels, permissions, guild administration and audit delivery. Prisma schema and versioned SQL migrations live in `prisma/`.

Prisma is pinned to the 6.x schema/client API. Patched `deepmerge-ts` and `effect` overrides address advisories in Prisma's configuration tooling; Prisma generation/validation and builds are verified with these overrides. Review and test dependencies before major upgrades.

Official references: [Discord bot setup](https://docs.discord.com/developers/quick-start/getting-started), [discord.js intents](https://discordjs.guide/legacy/popular-topics/intents), [slash command registration](https://discordjs.guide/legacy/app-creation/deploying-commands), [Prisma migrations](https://www.prisma.io/docs/orm/v6/prisma-migrate/getting-started).
