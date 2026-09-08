# Update the running VPS bot

First commit and push this version from your computer. These changes are not automatically pushed to GitHub or deployed to the VPS.

On your VPS, run each command separately and continue only when it succeeds:

```bash
cd ~/apps/vengeful-enforcer/vengefulenforcer
git pull --ff-only origin main
npm ci --include=dev
npm run prisma:migrate
npm run build
npm run register-commands
pm2 restart vengeful-enforcer
pm2 logs vengeful-enforcer --lines 30
```

After the ready message, exit the logs with Ctrl+C and run `pm2 save`. Only this bot is restarted; other PM2 applications remain running.

As a Discord administrator, choose the channel:

```text
-config globalchannel #global-bans
```

Then anyone with Discord **Ban Members** permission in that server can use these in that channel:

```text
-globalban USER_ID Reason
-globalunban USER_ID Reason
```

`/globalban` and `/globalunban` do the same thing. Actions run immediately. All servers the bot is in are automatically included, including previously disabled/unregistered servers. Existing active global bans will be synchronized to all joined servers when the updated bot starts.

No Control Server, global staff roles, protected-user management, registration commands, case commands or case numbers are needed. Existing notes, warnings, and bans remain stored. The migration only adds a channel setting; it deletes no data.

Optional: for exactly one global command channel across the whole bot, set `GLOBAL_COMMAND_CHANNEL_ID=CHANNEL_ID` in `.env`. This overrides per-server channel settings. Existing `CONTROL_GUILD_ID` and `BOT_OWNER_ID` values are ignored and can be removed. Keep `DISCORD_TOKEN`, `CLIENT_ID`, and `DATABASE_URL`.

Re-registering commands replaces the slash-command list in the selected scope and removes obsolete commands. If you previously registered guild-only commands using `COMMAND_GUILD_ID`, update that same scope as well; global and guild registrations are separate.
