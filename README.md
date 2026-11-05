# Pear Rent Bot

Telegram bot + Mini App for barbershop chair rental (MVP).

## Stage 5 status (admin UI + admin backend)

- Backend admin endpoints (all role-protected): chairs CRUD-ish (`GET /chairs`, `POST/PATCH /admin/chairs`, archive with future-booking conflict guard), renters list/card/status, schedule settings (`GET/PUT /admin/schedule/weekly`, exceptions CRUD) with **409 conflict payloads** when active bookings would be violated, invitations UI uses existing API, admin bookings list/payment/cancel (Stage 3) reused.
- Frontend admin: weekly calendar “chairs × dates”, day timeline/details, booking cards with renter + payment, payment toggle per booking, admin cancel, renters list/card + activate/deactivate (existing bookings not auto-cancelled), invitations list/create/revoke/copy link, chairs management, weekly schedule + date exceptions with conflict warnings, tariffs shown read-only.
- Data remains PostgreSQL-backed via API; admins see same data after refresh. Frontend hides controls by role but backend enforces RBAC.

### Stage 5 backend tests

```bash
cd backend
pytest -q tests/test_stage5_admin.py
pytest -q
```


### Frontend checks

```bash
cd frontend
npm install
npx tsc --noEmit
npm run build
```


### Backend tests

```bash
cd backend
pytest
ruff check .
```

Stage 3 coverage (local): pricing, schedule/override/conflict detection, booking create/cancel, overlaps, renter/admin visibility & RBAC, admin payment update. Parallel double-booking race is exercised in CI on PostgreSQL.




## Quick start (local)

```bash
cp .env.example .env
docker compose up --build
```

Services:
- Backend API: http://localhost:8000
- Health check: http://localhost:8000/health
- Frontend: http://localhost:5173
- PostgreSQL: localhost:5432

## Backend (without Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload
```

Run smoke/lint-adjacent checks:

```bash
cd backend
pytest
ruff check .
```

## Frontend (without Docker)

```bash
cd frontend
npm install
npm run dev
```

## Notes

- Secrets must not be committed. Use `.env` locally and secret managers in production.
- PostgreSQL is the source of truth for future business data.
- Admin bootstrap is configured via `ADMIN_TELEGRAM_IDS` (used in later stages; no self-admin assignment).
