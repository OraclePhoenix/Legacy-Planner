# Legacy Planner

Legacy Planner helps you organize end-of-life tasks, keep the people who matter in one place, and prepare text messages that reach them when the time comes, either because you send them yourself or because you have stopped signing in.

## What it does

- **Checklist**: tasks grouped by category (legal, financial, personal, medical, digital, other) with priority, due dates, notes and progress bars.
- **Contacts**: name, phone, relationship and priority. Phone numbers are validated and stored in international (E.164) format. CSV import with per-row error reporting, and CSV export.
- **Messages**: write a message per group of recipients. `{{name}}` is replaced with each recipient's name.
- **Sending**: send manually, or let the inactivity check do it (see below).
- **Activity log**: every sign-in, setting change and notification step, with who did it.
- **Emergency contacts**: people you trust, with their own accounts, who can report that something has happened or confirm a send. They see only your name and whether a run is in progress.
- **Admin**: review and confirm or reject inactivity runs for users who require it.

## How sending is protected

Nothing goes out from a single click or a single missed login.

**Manual send**
1. Review exactly who receives which message.
2. Type `SEND MY MESSAGES` and re-enter your password.
3. A waiting period starts (default 24 hours, 1 to 168). You get a text warning and can cancel with your password at any time before it ends.

Manual triggers are limited to 5 attempts per hour per account, and failed password attempts are logged.

**Inactivity check** (off by default; needs your own mobile number)
1. After N days without signing in (default 30), you get a check-in text.
2. If you don't sign in within the grace window (default 72 hours), the run either waits for an administrator to confirm (if you turned that on) or is scheduled.
3. A final waiting period (same as manual) runs, with another text to you, before anything is sent.

**Emergency contact report**
1. An emergency contact you added (and who accepted) reports that something has happened, re-entering their own password.
2. You get a text and the same check-in window as inactivity starts. Signing in stops it.
3. After that, the same confirmation and waiting steps as inactivity apply. The reporter can withdraw their report at any time.

You can require an emergency contact to confirm before an inactivity or reported run is scheduled. The person who reported can never be the one who confirms, so add at least two contacts who can confirm if you turn this on.

Signing in, or any activity while signed in, at any point before sending cancels an inactivity or reported run automatically. Nobody can confirm a run on their own account.

**Server-side guards**
- Only one open run per account, enforced by the database.
- Each message to each contact is recorded once, so a retry or a second server can never send it twice.
- `NOTIFICATIONS_ENABLED=false` is a master switch: scheduled runs wait and nothing is sent.
- Without Twilio credentials the app runs in mock mode and only logs messages.

## Security

- Passwords hashed with bcrypt; JWT sessions. Changing your password signs out every other device.
- Contact names, phone numbers, your own phone number and message bodies are encrypted at rest with AES-256-GCM.
- Helmet security headers, CORS locked to `FRONTEND_URL`, rate limits on sign-in and on the API, input validation on every route.

## Quick start (Docker)

```bash
cp .env.example .env
# Fill in JWT_SECRET, ENCRYPTION_KEY and POSTGRES_PASSWORD (generation commands are in the file).
# Leave the Twilio values blank to start in mock mode.
docker compose up --build
```

Open http://localhost:3000 and create an account.

To make someone an administrator:

```bash
docker compose exec backend npm run make-admin -- someone@example.com
```

## Local development

Requirements: Node 20+ and PostgreSQL 14+.

```bash
# Backend
cd backend
npm install
export $(grep -v '^#' ../.env | xargs)   # or set DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY yourself
npm run dev                               # http://localhost:4000, runs migrations on start

# Frontend (second terminal)
cd frontend
npm install
npm run dev                               # http://localhost:3000, proxies /api to :4000
```

### Tests

The backend tests run against a real PostgreSQL database named `legacy_test`:

```bash
createdb legacy_test
cd backend
TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/legacy_test npm test
```

They cover auth, ownership checks, encryption at rest, CSV import/export, and the full manual and inactivity send flows with simulated time.

## Configuration

All settings are environment variables; see `.env.example` for the full list with comments.

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Signs sign-in tokens. At least 32 characters in production. |
| `ENCRYPTION_KEY` | 64 hex characters. Encrypts contacts and messages. Back it up. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio credentials. Blank means mock mode. |
| `NOTIFICATIONS_ENABLED` | Master switch for sending. |
| `SCHEDULER_INTERVAL_MS` | How often inactivity and due sends are checked. |
| `DEFAULT_PHONE_COUNTRY` | Region for numbers entered without a country code. |

## Project layout

```
backend/
  migrations/        SQL schema
  src/
    routes/          REST endpoints
    services/        activations (send lifecycle), scheduler, sms, audit
    middleware/      auth, validation, errors
    utils/           encryption, phone validation, clock
  tests/             Jest + Supertest against PostgreSQL
frontend/
  src/pages/         Dashboard, Checklist, Contacts, Messages, Send, Emergency contacts, Activity, Settings, Admin
docker-compose.yml   PostgreSQL + API + Nginx-served frontend
```

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>` except sign-in.

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login` | Create account, sign in |
| GET, PATCH | `/me` | Profile and inactivity settings |
| POST | `/me/check-in`, `/me/password` | Check in, change password |
| GET, POST, PATCH, DELETE | `/checklist`, `/checklist/:id` | Tasks; `GET /checklist/summary` for progress |
| GET, POST, PATCH, DELETE | `/contacts`, `/contacts/:id` | Contacts; `POST /contacts/import`, `GET /contacts/export` |
| GET, POST, PATCH, DELETE | `/templates`, `/templates/:id` | Messages and their recipients |
| GET, POST | `/activations` | List runs; trigger with `{ password, confirmationPhrase }` |
| POST | `/activations/:id/cancel` | Cancel with `{ password }` |
| GET, POST, PATCH, DELETE | `/trustees`, `/trustees/:id` | Your emergency contacts |
| GET, POST | `/trustees/invitations`, `/trustees/invitations/:id/accept` or `/decline` | Invitations to be someone's emergency contact |
| GET | `/trustees/people` | People who trust you, and any run in progress |
| POST | `/trustees/people/:ownerId/report`, `.../activations/:id/confirm`, `.../activations/:id/withdraw` | Report, confirm or withdraw, each with `{ password }` |
| GET | `/audit` | Activity log (`page`, `limit`) |
| GET, POST | `/admin/activations`, `/admin/activations/:id/confirm`, `/:id/reject` | Admin only |
