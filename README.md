# Vengeful Enforcer

Simple Discord moderation with persistent bans, warnings and notes.

- Every server the bot is in automatically participates in global bans.
- Anyone with Discord **Ban Members** permission can globally ban/unban from the configured command channel.
- Global commands execute immediately, without a confirmation menu.
- Prefix and slash commands use the same services.
- Warnings and bans attempt a DM. Closed DMs do not stop moderation.
- Ban DMs include an appeal button when an appeal category is configured.
- Local and global bans use Discord's valid 7-day ban prune and then scan channels to delete that user's messages from the last 30 days.
- Notes, warnings and bans survive restarts.
- No Control Server, server registration, global staff roles or case commands.

## Already running the old version?

Follow [UPDATING.md](UPDATING.md). Existing notes and moderation records are preserved. When this version starts, existing active global bans apply to **all joined servers**, including previously disabled or unregistered ones.

## Setup

Use Node.js 22.12+ and PostgreSQL. On Windows, use npm.cmd if PowerShell blocks npm.ps1.

In the [Discord Developer Portal](https://discord.com/developers/applications), select your application:
1. Copy **Application ID** into CLIENT_ID.
2. Copy the **Bot token** into DISCORD_TOKEN. The Public Key is not needed.
3. Enable **Server Members Intent** and **Message Content Intent**.
4. Invite the bot using the bot and applications.commands scopes.
5. Give it View Channels, Send Messages, Embed Links, Read Message History, Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Channels and Manage Roles. View Audit Log is optional for identifying manual unbans.
6. Put the bot's role above the roles it moderates.

Create a dedicated PostgreSQL database. On Ubuntu, with PostgreSQL installed:

~~~bash
sudo -u postgres psql
~~~

~~~sql
CREATE ROLE vengeful WITH LOGIN;
\password vengeful
CREATE DATABASE vengeful OWNER vengeful;
\q
~~~

Copy .env.example to .env and fill in:

~~~dotenv
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
DATABASE_URL=postgresql://vengeful:your_password@localhost:5432/vengeful?schema=public
COMMAND_PREFIX=-
~~~

URL-encode special characters in the database password. Never commit .env or share your bot token.

Run each command separately and resolve any errors before continuing:

~~~bash
npm ci --include=dev
npm run prisma:migrate
npm run build
npm run register-commands
~~~

For PM2, use the same Linux account that owns your existing application list:

~~~bash
VE_NODE_BINARY="$(command -v node)" pm2 start ecosystem.config.cjs --only vengeful-enforcer
pm2 logs vengeful-enforcer --lines 30
~~~

After seeing **Vengeful Enforcer is ready**, exit the logs with Ctrl+C and run pm2 save. Future restarts use pm2 restart vengeful-enforcer. Other PM2 applications are unaffected. Do not use restart all, delete all or pm2 kill to manage this bot.

Without PM2, use npm start. Use npm run dev for local development. Run only one instance against the same database.

## Choose the command channel once

As a Discord administrator:

~~~text
-config globalchannel #global-bans
~~~

Or use /config globalchannel value:#global-bans.

Anyone with Ban Members in that server can now use globalban/globalunban **in that exact channel**. Other channels, including threads under it, are rejected. Other joined servers automatically receive the global bans without needing any setup.

You can configure a channel in another server too. If you want exactly one command channel for the entire bot, set GLOBAL_COMMAND_CHANNEL_ID to that channel's ID in .env and restart the bot. This optional setting overrides per-server channel configuration.

Optional server logs:

~~~text
-config logchannel #moderation-logs
~~~

Appeal tickets:

~~~text
-config appealcategory 123456789012345678
-config appealrole add @Appeal Staff
-config appealrole add @High Command
-config appealrole remove @Old Appeals
-config appealrole list
~~~

Use the appeal category ID, not a normal text channel. Appeal roles control who can see new appeal channels, and you can add more than one role. When a banned user clicks the DM appeal button, Vengeful Enforcer opens a staff-side appeal channel in that category with this format: name, Discord ID, reason for ban, and why they believe they should be unbanned.

Use -config to see the configured channels. Use none instead of a channel to clear a per-server setting.

## Commands

Every command has a slash equivalent. Every user-targeting command accepts a raw Discord user ID or an actual user mention. IDs are stored as strings without numeric rounding; usernames are optional display information. Slash user fields accept ID text, including users outside the server. Role/channel mentions and typed usernames are not treated as users.

Bans, global bans/unbans, warnings, notes and history support absent users by ID. Kicks and timeouts also accept IDs, but Discord requires the target to be a current server member. Note edit/remove use the note's ID to identify which specific note to change.

| Prefix command | Action |
| --- | --- |
| -globalban USER REASON | Ban across every joined server |
| -globaltempban USER TIME REASON | Temporarily ban across every joined server |
| -globalunban USER REASON | Revoke the global ban and unban across every joined server |
| -note add USER TEXT | Save a permanent staff note |
| -note list USER | Read notes |
| -note edit NOTE_ID TEXT | Update a note |
| -note remove NOTE_ID | Remove a note from the list while preserving its stored history |
| -warn USER REASON | Record a warning and attempt a DM |
| -warnings USER | View saved warnings |
| -history USER | View moderation history without case numbers |
| -ban USER REASON | Local ban with a DM attempt |
| -unban USER REASON | Local unban; use globalunban if a global ban is active |
| -kick USER REASON | Kick a member |
| -timeout USER 1h REASON | Timeout, up to 28 days |
| -untimeout USER REASON | Remove a timeout |
| -clear 10 | Delete up to 100 recent messages |
| -slowmode 10 | Slowmode seconds; 0 disables |
| -lock / -unlock | Change and restore @everyone Send Messages |
| -config | Show configured channels |
| -config appealcategory CATEGORY_ID | Set the category where appeal channels are created |
| -config appealrole add @Role | Let a role see appeal channels |
| -config appealrole remove @Role | Remove a role from appeal channels |
| -config appealrole list | Show appeal roles |
| -help | Show the command reference |

Examples:

~~~text
-globalban 123456789012345678 Repeated harassment
-globaltempban 123456789012345678 7d Ban evasion
-globalunban 123456789012345678 Appeal accepted
-note add 123456789012345678 Watch for repeated spam
-warn @TestUser Please stop spamming
~~~

Slash examples: /globalban user:ID reason:Reason, /globaltempban user:ID duration:7d reason:Reason, /globalunban user:ID reason:Reason, /note add user:ID text:Text.

Aliases: gban / gb, gtban / gtb, gunban, hist / record. Globalban and globaltempban also accept optional --evidence URL at the end of the prefix command, or the evidence slash option.

## Permissions and behavior

Global bans, global temp bans and global unbans require Discord Ban Members and the configured command channel. That channel lock only applies to those three global commands. Local moderation, notes, warnings, history and config commands can be used anywhere the user's Discord permissions allow. No old owner/staff grants or configured custom roles bypass this requirement. Local moderation uses the corresponding native Discord permission. Notes, warnings and history require Moderate Members or Ban Members. Channel configuration requires Discord Administrator.

Discord hierarchy still applies: staff cannot punish equal/higher roles in their server, and the bot cannot punish server owners, itself, or members above its role. Each destination is attempted separately, so one failed server does not stop the rest.

Bans are notified before removal while a shared server may still allow DM delivery. Notices state that enforcement is about to be attempted, since the API can fail. Notices include the reason and date without case numbers. No private notes or evidence are included in DMs. Ban notices include an appeal button. Because banned users cannot see channels inside a server they are banned from, the appeal channel is created for staff review in the configured appeal category.

Global bans remain in PostgreSQL. On startup and every 15 minutes by default, missing bans are restored, unfinished global unbans are retried, and expired global temp bans are revoked. Newly joined servers automatically receive existing global bans. Globally banned members are re-banned on join. Manual Discord unbans are reversed while the global ban is active; use globalunban to revoke it everywhere. Set SYNC_INTERVAL_MINUTES to change the background interval.

Removing the bot from a server stops future enforcement there but does not remove its existing Discord bans. Global unban affects servers the bot is currently in.

The update retains legacy database tables for compatibility and recovery; no case interface or case numbers are exposed. Existing notes and historical actions are not deleted. Local records retain their guild visibility, and existing note-sharing opt-ins retain their prior visibility.

## Operations

Keep the database backed up and restrict staff channels. Prefix responses appear in their channel; slash responses are ephemeral. Logging channels are optional; persistent records remain even if Discord log delivery fails.

The bot uses one Gateway process and a PostgreSQL session advisory lock. Use a direct PostgreSQL connection or session-mode pooler. On shutdown it drains pending work for up to 25 seconds; the PM2 config allows 30 seconds. Do not run multiple instances or cluster mode.

If a crash makes a local action or DM outcome uncertain, its record becomes UNKNOWN instead of automatically repeating it. Global actions are idempotently reconciled. Discord and PostgreSQL cannot commit as one transaction.

The included Docker Compose setup remains available: set POSTGRES_PASSWORD in .env and run docker compose up --build -d. It migrates and registers commands before starting the bot. The named PostgreSQL volume stores permanent data. Do not run Docker and PM2 copies of the same bot together.

## Checks

~~~bash
npm run check
npm run build
~~~

The check command validates Prisma, TypeScript and the automated tests. It requires a syntactically valid DATABASE_URL but does not connect to that configured database. Tests cover channel/permission boundaries, direct prefix/slash dispatch, automatic participation, per-server failures, warning and ban DMs, persistence, and migration without data loss.

CI also runs migrations and scripts/check-postgres.mjs against a disposable PostgreSQL database. Live Discord behavior requires your token and test servers.
