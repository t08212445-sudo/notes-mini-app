# Netlify package

Готовый пакет только для Netlify: Mini App + Netlify Function + Netlify Blobs.

Переменные Netlify:
- BOT_TOKEN — новый токен Telegram-бота.
- MINIAPP_SYNC_SECRET — тот же секрет, что используется ботом на Pterodactyl.
- SITE_URL — адрес сайта Netlify (необязательно).

Настройки уже в netlify.toml: publish `.` и functions `netlify/functions`.

После изменения переменных обязательно сделать новый Deploy.

Сохранение напоминаний идёт только через:
Mini App → /.netlify/functions/reminders → Netlify Blobs.

`sendData()` не используется как резервный способ, чтобы приложение не показывало ложное «Сохранено» при ошибке API.
