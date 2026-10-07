# Netlify Mini App v12

Deploy the CONTENTS of this folder as the Netlify site.

Required environment variables:
- `BOT_TOKEN` — current Telegram bot token (do not share it).
- `MINIAPP_SYNC_SECRET` — the same secret configured in Pterodactyl.
- `SITE_URL` — optional, set to the exact Netlify site URL.

The Mini App saves only through `/.netlify/functions/reminders` using Telegram `initData`.
`sendData()` is not used as a save fallback, because Menu/Open launches do not reliably deliver `web_app_data` to the bot.

Cloud data is stored in Netlify Blobs store `notes-reminders`.
The bot sync endpoint supports a two-way recovery flow: if Netlify is empty but the bot still has old Mini App reminders, the bot uploads them back to the cloud. Confirmed deletions are protected by tombstones so deleted reminders are not resurrected.
