# Flood City Elite — Member Portal

A [Next.js](https://nextjs.org) (App Router) app with a branded home/login
screen backed by a [Neon](https://neon.tech) Postgres database. Members sign in
with a **company code**, **username**, and **password**.

- Home screen (`/`) — three **division cards**: **Admin** (the Flood City Elite
  staff/coach login), **Payroll** (a link to a public form employees use to
  submit their hours — no account needed), and **Roster Spot** (a link to a
  public form parents use to accept or decline a roster spot — no account
  needed).
- Payroll form (`/payroll`) — a public, login-free page where employees log the
  hours they worked (name, role, division, date, hours, notes). Submissions feed
  the admin **Payroll** tab.
- Roster acceptance form (`/roster-acceptance`) — a public, login-free page
  where a parent accepts or declines their player's roster spot. Accepting also
  adds the player to the chosen team's roster. Responses feed the admin **Roster
  Submissions** tab.
- Member area — a protected tabbed shell (Homeplate, Teams, Roster Submissions,
  Payment Tracker, Budgets, Fundraiser Tracker, Program/Camps, Payroll, Contact
  Info, Yard Tournaments, Hotels, Inventory) shown after a successful login and
  guarded by middleware.
- Auth — passwords are hashed with **bcrypt**; the session is a signed
  (JWT, HS256) **httpOnly** cookie.

## Login credentials

| Field        | Value                                                            |
| ------------ | ---------------------------------------------------------------- |
| Company code | `fce`                                                            |
| Username     | `admin` (default seed username)                                  |
| Password     | your `SEED_ADMIN_PASSWORD`, or a strong random one generated and printed once by `npm run db:setup` |

> The company code for Flood City Elite is always `fce`. The admin password is
> never hardcoded — set your own via `SEED_ADMIN_PASSWORD` or use the one the
> seed step prints, and change it after first login.

## Database tables

Several tables back the app (see [`db/schema.sql`](db/schema.sql)); the core
ones are:

- **`companies`** — one row per organization. Login matches on `code`
  (e.g. `fce`).
- **`users`** — belongs to a company via `company_id`. A username is unique
  *within* a company. Stores `password_hash`, `role`, `is_active`, and
  `last_login_at`.
- **`teams`** — belongs to a company. Each team lives in a `division`
  (`spring-summer-baseball`, `softball`, or `fall-baseball`) and is assigned a
  `sport` (`baseball` or `softball`). This powers the **Teams** tab.
- **`players`** — roster rows that belong to a team via `team_id`
  (`ON DELETE CASCADE`). Only `player_name` is required; the rest (grad year,
  date of birth, height, weight, positions, jersey number, hat size, high
  school, parent contact, closest facility) can be filled in over time. Each
  player also carries an
  `is_paying` flag (default `true`) shown as a **Paying** checkmark on the Teams
  roster; the Budgets tab's paying-player count is the number of players marked
  paying (with an optional manual override on the budget for edge cases).
- **`payments`** — payments logged against a player via `player_id`
  (`ON DELETE CASCADE`). Each row records `paid_on`, a `payment_type` (`check`
  or `cash`), an optional `check_number` (for check payments), and an `amount`.
  This powers the **Payment Tracker** tab, whose Total column accumulates the
  payments received.
- **`camps`**, **`camp_players`**, **`camp_payments`** — the **Program/Camps**
  tab. A `camp` is a program/clinic owned by a company (name, optional location
  and date). Each `camp_player` is a registration on that camp's roster
  (`player_name` plus the parent's name, a parent contact, and a location) and
  is independent of the Teams roster. A `camp_payment` is logged against a camp
  player and mirrors `payments` (`paid_on`, `payment_type`, `check_number`,
  `amount`), driving the per-player and per-camp totals.
- **`payroll_submissions`** — the **Payroll** tab, which has two subtabs:
  **Submissions** and **Reports**. Each row is one employee's logged hours for a
  day, submitted through the public `/payroll` form (no login): `employee_name`,
  an optional `role`, an optional `division` (a teams division slug, or null
  when unassigned), the `work_date`, the `hours`, an approval `status`
  (`pending` → `approved`/`denied`), and optional `notes`. Belongs to a company
  via `company_id`. On the Submissions subtab the admin approves or denies each
  entry with an inline status dropdown; the Reports subtab filters by date
  range, division, and status, groups totals by division, and rolls hours up per
  employee for a pay period.
- **`roster_submissions`** — the **Roster Submissions** tab. Each row is one
  parent's response to a roster offer, submitted through the public
  `/roster-acceptance` form (no login). `accepted` is the accept/decline
  decision; a decline records just the `player_name`, while an accept also
  carries the player's details and the parent's contact info. When a parent
  accepts, the player is pushed onto the chosen team's roster in the same write
  — `player_id` links to that `players` row, and `team_name`/`division` snapshot
  the choice so it survives the team being deleted (which nulls `team_id`). The
  accept also copies the player's high school and hat size onto the roster row.
  Jersey numbers are then assigned automatically for the whole team (see below). The remaining
  fields — `played_fce_2026` (the "Did you play in 2026?" returning-player
  answer), the returning number, the three jersey option preferences, secondary
  phone, and bats/throws — live on the submission. Belongs to a company via
  `company_id`.

  **Jersey automation.** When a team's roster changes through an acceptance,
  every submission-linked player's `jersey_number` is reconciled from all of the
  team's accepted submissions: returning players (`played_fce_2026 = true`) get
  their returning number with priority, then new players are assigned
  first-come-first-served, each taking the first of their three ranked options
  that isn't already taken. Numbers a coach assigned by hand on the Teams tab
  (players with no submission) are treated as fixed and never reassigned; a
  player whose options are all taken is left blank for the coach to resolve.

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment** — copy the example and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   - `DATABASE_URL` — your Neon connection string (Neon console → **Connect** →
     pooled connection string).
   - `SESSION_SECRET` — a random secret: `openssl rand -base64 32`.

3. **Create the tables and seed the admin user**

   ```bash
   npm run db:setup
   ```

   This creates the tables, ensures the `fce` company exists, and creates the
   default admin user. It prints the credentials when it finishes.

   > Prefer to do it by hand? Paste [`db/schema.sql`](db/schema.sql) into the
   > Neon **SQL Editor** instead — then create a user with a bcrypt hash.

4. **Run the app**

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000> and sign in.

## Adding more users

Each user belongs to the `fce` company. To add one, insert a row into `users`
with a bcrypt-hashed password. The quickest way is to reuse the seed pattern in
[`db/setup.mjs`](db/setup.mjs), or generate a hash:

```bash
node -e "import('bcryptjs').then(b => b.default.hash(process.argv[1], 10).then(console.log))" 'their-password'
```

then:

```sql
INSERT INTO users (company_id, username, password_hash, full_name, role)
VALUES (
  (SELECT id FROM companies WHERE code = 'fce'),
  'coach', '<paste-hash>', 'Coach Name', 'coach'
);
```

## Tech

Next.js 15 · React 19 · `@neondatabase/serverless` · `bcryptjs` · `jose`
