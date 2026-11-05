# Pear Rent Bot — UI Redesign Context (handoff)

Контекст для отдельного ИИ-агента, задача которого — сделать более красивый/удобный UI Telegram Mini App **без поломки текущего поведения, API-контрактов и бизнес-логики**.

## 1) Что это за продукт
Telegram bot + Mini App для аренды кресел в барбершопе (MVP).

- Роли: `admin`, `renter` (определяются backend/JWT; UI только скрывает элементы, права проверяет backend).
- Таймзона бизнеса: `Europe/Minsk`. Рабочий график по умолчанию 09:00–22:00, шаг 1 час.
- 2 кресла (seed), но UI должен работать с N кресел/данными из API.
- Источник истины — PostgreSQL через backend API; фронт не вычисляет доступность/цены авторитетно, только отображает данные API и отправляет команды.

## 2) Технический стек фронтенда
- React + TypeScript + Vite (`frontend/`).
- Dev-сервер: `vite --host 0.0.0.0 --port 5173`, `frontend/vite.config.ts` имеет `allowedHosts: true` и proxy `/api -> VITE_DEV_PROXY_TARGET` (в Docker обычно `http://backend:8000`). Это нужно для локального теста через один ngrok URL.
- Стили сейчас в `frontend/src/styles/index.css` (глобальные классы: `.app`, `.card`, `.row`, `.week-grid`, `.chip`, `.slot`, `.error`, `.ok`, `.muted` и т.д.). Можно рефакторить стили/добавить дизайн-систему/CSS modules/Tailwind — но нужно не сломать существующие компоненты или аккуратно мигрировать.
- Нет отдельного router-пакета; навигация простая/условная в `App.tsx` по роли и локальному состоянию.

## 3) Telegram Mini App ограничения (обязательно учитывать)
- Приложение открывается в Telegram WebView. В `frontend/index.html` должен оставаться `<script src="https://telegram.org/js/telegram-web-app.js"></script>`.
- Авторизация только через `Telegram.WebApp.initData` → `POST /api/v1/auth/telegram` (проверка подписи на backend). В обычном браузере `initData` нет — показывается понятное сообщение, не ломать.
- WebApp-кнопки/ссылки Mini App требуют HTTPS. Локально используется ngrok; Vite `allowedHosts: true` уже настроен.
- UI должен быть mobile-first, удобен на узком экране Telegram; учитывать safe areas/viewport (`viewport-fit=cover` уже есть).

## 4) Авторизация и состояния
Файлы: `frontend/src/features/auth/AuthContext.tsx`, `RegisterGate.tsx`, `frontend/src/api/client.ts`.

Состояния:
- `loading` — проверка `initData`/токена.
- `anonymous` — нет `initData` (не в Telegram) ИЛИ `403 registration_required` (нужна регистрация по приглашению) ИЛИ другие ошибки. Показывать причину; для `registration_required`/invite flow — форму/кнопку регистрации.
- `ready` — есть JWT + `/auth/me`.

Invite flow:
- Токен берётся из `Telegram.WebApp.initDataUnsafe.start_param`, query `invite_token`/`startapp` (см. `getInviteToken()` в `client.ts`). Формат startapp: `invite_<token>`.
- `POST /api/v1/auth/register` с `{ init_data, invite_token }` → 201 + access token; после успеха `refresh()`/переход в `ready`.
- Прямая ссылка `t.me/<bot>?startapp=invite_...` зависит от BotFather Menu Button/Web App URL и может не доходить до локального ngrok (ngrok free interstitial) — это инфраструктурный нюанс, не UI-логика.

## 5) Роли и экраны
Маршрутизация по роли: `frontend/src/app/App.tsx`.

### Renter
- `RenterSchedule` (`features/schedule/RenterSchedule.tsx`): недельный календарь/выбор дня и кресла, загрузка `GET /schedule/weekly?week=YYYY-MM-DD`, `GET /schedule/day?date=YYYY-MM-DD`.
- `ChairPicker` (`features/schedule/ChairPicker.tsx`): почасовые слоты и полный день, расчёт/показ цены до подтверждения, создание брони `POST /bookings`.
- `MyBookings` (`features/bookings/MyBookings.tsx`): список активных броней `GET /bookings/my`, отмена `POST /bookings/:id/cancel`.

Renter **не видит** чужие данные и `payment_status` (backend скрывает); не имеет доступа к admin endpoints.

### Admin
- `AdminApp` (`features/admin/AdminApp.tsx`) — контейнер админки.
- `AdminCalendar` — «кресла × даты», таймлайн/детали дня.
- `BookingCard` — карточка брони: арендатор, статус оплаты, отмена.
- `RentersAdmin`, `InvitationsAdmin`, `SettingsAdmin` — арендаторы, приглашения, кресла/расписание/исключения.
- Admin видит `renter` и `payment_status`; меняет оплату **только конкретной брони** (`PATCH /admin/bookings/:id/payment`). Отмена любой брони: `POST /bookings/:id/cancel`. Конфликты расписания/кресел приходят 409 с payload — UI должен показывать предупреждение (`conflictText` в `client.ts`).

## 6) Критичные контракты (не ломать)
### Даты/время бронирования
**Важно (был баг):** бронирования в MVP интерпретируются в `Europe/Minsk`, целые часы, в пределах рабочего дня/одного дня.
- Фронт должен отправлять `starts_at`/`ends_at` как **локальное время магазина без `Z`**, формат `YYYY-MM-DDTHH:MM:00` (например `2026-11-06T09:00:00`), либо offset-aware; naive трактуется backend как Minsk. **Не отправлять `Z` для shop-local выбора слотов** — это смещало full-day/слоты.
- `booking_type`: `"hourly"` | `"full_day"`. Full-day покрывает полный рабочий интервал дня (обычно 09:00–22:00).
- После создания/отмены обновлять расписание/списки без перезагрузки приложения.

### Цены (отображение должно совпадать с бизнес-правилами MVP)
- Full day: 60 BYN (`6000` копеек). Почасовая: 1ч=10, +5 за каждый следующий час (1→1000, 2→1500, 3→2000, 4→2500, 8→4500 копеек) — см. `calcHourlyPrice`/`formatMoney` в `features/schedule/time.ts`. Backend всё равно считает/валидирует сам; UI-подсказка не должна вводить в заблуждение.

### Ошибки API
`ApiError(status, detail, message)` в `frontend/src/api/client.ts`. `detail` может быть строкой или объектом `{ message, code, conflicts, ... }`. Показывать человекочитаемые сообщения: 409 конфликт → обновить доступность; 422 валидация → объяснение; 401/403 → auth/RBAC.

## 7) API (основные endpoints)
Base URL: `VITE_API_BASE_URL` (default `/api/v1`, через Vite proxy в dev). Auth: `Authorization: Bearer <JWT>`.

- `POST /auth/telegram` `{ init_data, start_param? }` → `{ access_token, user }` или 403 `registration_required`.
- `POST /auth/register` `{ init_data, invite_token }` → 201.
- `GET /auth/me`.
- `GET /schedule/weekly?week=YYYY-MM-DD`, `GET /schedule/day?date=YYYY-MM-DD`.
- `POST /bookings`, `GET /bookings/my`, `GET /bookings/:id`, `POST /bookings/:id/cancel`.
- Admin: `/admin/bookings`, `PATCH /admin/bookings/:id/payment`, `/admin/renters*`, `/admin/invitations*`, `/chairs`, `/admin/chairs*`, `/admin/schedule/weekly`, `/admin/schedule/exceptions*`.

Типы фронта: `frontend/src/api/types.ts`. При изменении UI не менять payload’ы без синхронизации с backend.

## 8) Известные нюансы/не делать
- Не добавлять self-admin, не доверять идентичности с фронта, не обходить RBAC.
- Не показывать оплату/чужие персональные данные арендатору.
- Не отправлять уведомления об оплате (бэкенд этого не делает; UI не должен обещать).
- Не использовать `http://localhost` как Mini App URL для Telegram WebApp-кнопок — только HTTPS (в боте кнопка фильтруется; локально нужен ngrok).
- Не коммитить `.env`/секреты (уже gitignored). Токен бота/`SECRET_KEY`/ngrok домен — в `.env`.
- Есть старые предупреждения вне UI: Starlette/httpx testclient deprecation, PyJWT InsecureKeyLengthWarning (короткий `SECRET_KEY` в dev), `ruff` E501 — не часть задачи редизайна, но не ухудшать.

## 9) Файлы, которые стоит передать агенту на редизайн UI

### Обязательно (контекст + визуальные компоненты + стили)
- `docs/UI_REDESIGN_CONTEXT.md` (этот файл).
- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/app/App.tsx`
- `frontend/src/app/ErrorBoundary.tsx`
- `frontend/src/styles/index.css`
- `frontend/src/api/client.ts` (API base, `ApiError`, token, `conflictText`)
- `frontend/src/api/types.ts`
- `frontend/src/features/auth/AuthContext.tsx`
- `frontend/src/features/auth/RegisterGate.tsx`
- `frontend/src/features/schedule/time.ts` (форматы, `calcHourlyPrice`, `formatMoney`)
- `frontend/src/features/schedule/RenterSchedule.tsx`
- `frontend/src/features/schedule/ChairPicker.tsx`
- `frontend/src/features/bookings/MyBookings.tsx`
- `frontend/src/features/admin/AdminApp.tsx`
- `frontend/src/features/admin/AdminCalendar.tsx`
- `frontend/src/features/admin/BookingCard.tsx`
- `frontend/src/features/admin/RentersAdmin.tsx`
- `frontend/src/features/admin/InvitationsAdmin.tsx`
- `frontend/src/features/admin/SettingsAdmin.tsx`

### Полезно для сборки/окружения
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/tsconfig.json`
- `.env.example` (только шаблон, без секретов)
- `docker-compose.yml` (frontend service, Vite proxy env) — если агент будет учитывать dev/ngrok.

### Передавать только при необходимости менять поведение/контракты (обычно не надо для чистого UI)
- Backend API/схемы: `backend/app/api/v1/*.py`, `backend/app/schemas/*.py`, `backend/app/services/*.py` — давать только если агенту нужно уточнить детали ответов/ошибок. Лучше сначала решить UI по `types.ts` + этому контексту.

## 10) Definition of Done для редизайна
- Визуально аккуратный mobile-first UI в Telegram WebView, понятные состояния loading/empty/error/conflict.
- Сценарии работают: вход админа, регистрация по приглашению, выбор слота/whole day, цена до подтверждения, создание/отмена, «Мои бронирования», админ: календарь/брони/оплата/приглашения/арендаторы/кресла/расписание/исключения.
- Не сломаны auth (`initData`), роли, API payload’ы (особенно **datetimes без `Z` для shop-local**), обновление данных после действий.
- `cd frontend && npm run build` проходит. Существующие backend-тесты не затрагиваются UI-рефактором; при правках фронта проверять руками в Telegram через ngrok.
