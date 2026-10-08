# Mini App v14

Deploy the **contents** of this folder as a Netlify site.

Required environment variable:
- `BOT_TOKEN` — token of the same Telegram bot.

Optional:
- `SITE_URL` — exact site URL.

The Mini App and bot use the same Netlify Blobs store: `notes-reminders`.

## Storage model

Each Telegram user has an index:
- `u/<telegram_user_id>` — reminder IDs belonging to that user.
- `r/<reminder_id>` — reminder itself.
- `meta/users` — known Telegram user IDs.
- `meta/deleted` — deletion tombstones preventing deleted reminders from being recreated by an old local copy.

The old `store.list()` format is migrated automatically when the new user index does not exist yet.

## Authentication

Mini App requests use Telegram `initData` when available. Bot-generated Mini App URLs also contain a short-lived HMAC-signed launch token made with the existing `BOT_TOKEN`.

No `MINIAPP_SYNC_SECRET` is required.
