# Netlify Mini App

Загрузи эту папку как сайт Netlify.

## Environment variable

Нужна только одна переменная:

`BOT_TOKEN` = токен Telegram-бота.

`MINIAPP_SYNC_SECRET` больше не используется.

## API

Все операции идут через:

`/.netlify/functions/reminders`

Владелец напоминаний определяется по Telegram `user_id`.

Mini App принимает два способа авторизации:

1. стандартный Telegram `initData`;
2. короткоживущий подписанный `launch`-токен, который бот добавляет в URL.

Это позволяет одинаково работать при открытии из Telegram-кнопок и через меню Mini App.
