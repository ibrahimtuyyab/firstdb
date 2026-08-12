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
| `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | PostgreSQL connection |
| `PORT` | HTTP port for the server |
| `JWT_SECRET` | Signing secret for auth tokens |

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
