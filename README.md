# firstdb

A small school-management REST API and web UI built with Express and PostgreSQL.
It handles login with JWT, role-based access (admin / teacher / student), student and
teacher records, and CSV bulk import.

## Stack

- Node.js + Express 5
- PostgreSQL (`pg`)
- JWT auth (`jsonwebtoken`) with `bcrypt` password hashing
- `multer` + `csv-parser` for CSV uploads
- Static frontend in `public/`

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your real values
node server.js
```

The server listens on `PORT` (default 5000) and serves the UI from `public/`.

### Environment variables

See `.env.example`. `.env` is gitignored — never commit real credentials.

| Variable | Purpose |
| --- | --- |
| `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | PostgreSQL connection (local dev) |
| `DATABASE_URL` | Hosted Postgres connection string; overrides the `DB_*` vars and enables TLS |
| `PORT` | HTTP port for the server |
| `JWT_SECRET` | Signing secret for auth tokens |
| `SHARED_PASSWORD` | Shared login password for teachers and students |

## Deploying to Vercel

`vercel.json` rewrites `/api/*` to `api/index.js`, which re-exports the Express
app; `public/` is served as static assets. `server.js` only calls `app.listen()`
when run directly, so the same file works locally and as a serverless function.

Before it will run you must:

1. Provision a hosted Postgres (Neon, Supabase, or Vercel Postgres) — a
   serverless function cannot reach `localhost`.
2. Load your schema and data into it.
3. Set `DATABASE_URL`, `JWT_SECRET`, and `SHARED_PASSWORD` in the Vercel
   project's environment variables, then redeploy.

Note that uploaded CSVs land in `/tmp` and do not persist between invocations.

## Scripts

- `create-user.js` — create a user account from the command line
- `migrate-roles.js` — migrate/seed the role columns

## API

All routes except `/api/login` require a `Bearer` token.

| Method | Route | Role |
| --- | --- | --- |
| POST | `/api/login` | public |
| GET | `/api/me` | any |
| GET | `/api/departments` | any |
| GET/POST/PUT/DELETE | `/api/teachers`, `/api/teachers/:id` | admin |
| POST | `/api/teachers/import` | admin |
| GET | `/api/items`, `/api/items/:id` | any |
| POST/PUT | `/api/items`, `/api/items/:id` | admin, teacher |
| POST | `/api/items/import` | admin, teacher |
| DELETE | `/api/items/:id`, `/api/items/all/confirm` | admin |

## Pages

`public/` contains `login.html`, `index.html`, `student.html`, `employee.html`,
`directory.html`, and `profile.html`.
