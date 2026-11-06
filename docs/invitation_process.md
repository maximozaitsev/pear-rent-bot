# Процесс приглашения администратора и принятия приглашения арендатором

## Обзор

Администратор генерирует одноразовый 6-значный код приглашения. Код передаётся арендатору вне системы (сообщение в Telegram). Арендатор открывает мини-приложение, авторизуется через Telegram и вводит код; после успешной проверки создаётся пользователь с ролью `renter`, а приглашение помечается как использованное. Код хранится в БД как есть (6 цифр, уникален).

## 1. Создание приглашения администратором

1. Администратор в мини-приложении переходит на вкладку «Приглашения» (`InvitationsAdmin`).
2. Нажимает «+ Создать код приглашения».
3. Фронтенд вызывает `POST /api/v1/admin/invitations`.
4. Backend (`app/api/v1/invitations.py::create`) проверяет права через `require_admin`.
5. Сервис `app/services/invitations.py::create_invitation`:
   - проверяет `created_by.role == admin`;
   - генерирует уникальный 6-значный код (`secrets.randbelow`);
   - сохраняет `Invitation` со статусом `pending`, `token_hash = sha256(code)`, `created_by`;
   - возвращает приглашение и открытый код (код показывается только один раз, в ответе создания).
6. Фронтенд формирует сообщение для отправки арендатору (ссылка на бота + код) и позволяет скопировать его.
7. Администратор может отозвать неиспользованное приглашение: `POST /api/v1/admin/invitations/{id}/revoke` → статус `revoked`, проставляется `revoked_at`.

## 2. Принятие приглашения арендатором

1. Арендатор открывает бота, запускает мини-приложение.
2. Фронтенд вызывает `POST /api/v1/auth/telegram` с `init_data`.
3. Backend (`app/api/v1/auth.py::auth_telegram`):
   - валидирует `init_data` (`app/core/telegram_auth.py`);
   - если пользователь не найден — возвращает `403` с `code: registration_required`;
   - фронтенд показывает экран `RegisterGate` с полем ввода 6-значного кода.
4. Арендатор вводит код и отправляет форму.
5. Фронтенд вызывает `POST /api/v1/auth/register` (`init_data`, `code`).
6. Backend (`app/api/v1/auth.py::register`):
   - валидирует `init_data`;
   - запрещает регистрацию администраторов по приглашению;
   - если пользователь уже существует — ошибка;
   - вызывает `register_renter_with_invite`.
7. Сервис `app/services/invitations.py::register_renter_with_invite`:
   - хеширует введённый код;
   - блокирует строку приглашения `SELECT ... FOR UPDATE`;
   - проверяет статус: `pending` (иначе 404/409 с причиной);
   - проверяет, что пользователь с таким `telegram_id` не существует (админ не может зарегистрироваться по приглашению);
   - создаёт `User` с `role = renter`, `is_active = true`;
   - помечает приглашение `used`, заполняет `used_by`, `used_at`.
   - коммитит транзакцию.
8. Backend выдаёт JWT (`create_access_token`) и данные пользователя.
9. Фронтенд сохраняет токен (`setToken`) и обновляет состояние авторизации (`refresh`).

### Дополнительные пути
- `POST /api/v1/auth/dev-bypass` — локальная отладка (при `DEV_INSECURE_AUTH_BYPASS=1`), также принимает `invite_code`.
- `POST /api/v1/auth/complete-registration` — заполнение имени/телефона после регистрации.

## 3. Статусы приглашения

- `pending` — создано, не использовано.
- `used` — использовано арендатором (однократно).
- `revoked` — отозвано администратором.

## 4. Участвующие файлы

### Backend
- `backend/app/models/invitation.py` — модель `Invitation`, enum `InvitationStatus`.
- `backend/app/models/user.py` — модель `User`, роли `UserRole`.
- `backend/app/services/invitations.py` — `create_invitation`, `list_invitations`, `revoke_invitation`, `register_renter_with_invite`.
- `backend/app/api/v1/invitations.py` — эндпоинты администратора (create/list/revoke).
- `backend/app/api/v1/auth.py` — `auth_telegram`, `register`, `dev_bypass`, `complete_registration`.
- `backend/app/api/v1/__init__.py` — подключение роутеров (`/admin/invitations`, `/auth`).
- `backend/app/core/auth.py` — `require_admin`, `create_access_token`, `get_current_user`.
- `backend/app/core/telegram_auth.py` — валидация `init_data`.
- `backend/app/core/config.py` — `admin_telegram_id_list`, `telegram_bot_token`.
- `backend/app/schemas/auth.py` — `RegisterRequest`, `InvitationOut`, `InvitationCreatedOut`, `AuthResponse`.
- `backend/app/core/db.py` — сессия БД.

### Frontend
- `frontend/src/features/admin/InvitationsAdmin.tsx` — UI создания/просмотра/отзыва приглашений.
- `frontend/src/features/admin/AdminApp.tsx` — вкладка «Приглашения».
- `frontend/src/features/auth/RegisterGate.tsx` — экран ввода кода арендатором.
- `frontend/src/api/client.ts` — `register`, `devBypass`, `adminInvitations`, `adminCreateInvitation`, `adminRevokeInvitation`.
- `frontend/src/api/types.ts` — тип `Invitation`.

### Тесты
- `backend/tests/test_stage2_invitations.py` — создание/список/отзыв, однократное использование, невалидные/отозванные/использованные коды, параллельная гонка.
- `backend/tests/test_stage2_auth.py` — авторизация/регистрация.

## 5. Безопасность

- Код хранится как есть (`code`), администратор видит все активные коды и может копировать их повторно.
- Регистрация по приглашению создаёт только роль `renter`; админ не может зарегистрироваться через инвайт.
- Однократное использование обеспечивается блокировкой строки (`FOR UPDATE`) и проверкой статуса.
- Повторное использование/отозванный/несуществующий код возвращают 404/409.
- Администратор создаёт и отзывает приглашения только при наличии прав `require_admin`.
