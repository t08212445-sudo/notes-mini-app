# Netlify — fixed reminder Mini App

Deploy this folder as the Netlify site.

Environment variables:
- `BOT_TOKEN` — current Telegram bot token.
- `MINIAPP_SYNC_SECRET` — preferred dedicated bot↔Netlify secret.

The function accepts the dedicated sync secret and, temporarily, a legacy
sync header derived from `BOT_TOKEN`, so an already configured Netlify site
continues to sync while `MINIAPP_SYNC_SECRET` is being migrated.

After changing environment variables, trigger a new Netlify deploy.
