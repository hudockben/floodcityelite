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
  where a parent accepts or declines their player's roster spot. The division and
  team are required on both answers, so a decline still shows which spot was
  turned down. Accepting also adds the player to the chosen team's roster.
  Responses feed the admin **Roster Submissions** tab.
- Member area — a protected tabbed shell (Homeplate, Teams, Roster Submissions,
  Payment Tracker, Budgets, Fixed Cost, Schedules, Fundraiser Tracker,
  Program/Camps, Payroll, Contact Info, Hotels, Inventory) shown after a
  successful login and guarded by middleware.
- Auth — passwords are hashed with **bcrypt**; the session is a signed
  (JWT, HS256) **httpOnly** cookie.

## Organizations (multi-tenant)

The portal runs the same software for more than one organization. Each one is a
**tenant**: its own login company code, its own branding, and — the point of the
whole arrangement — **its own Postgres database**. Nothing is shared between
tenants at the storage layer, so there is no query, however wrong, that can
return one organization's rows to another's screen.

| Organization       | Company code | Connection string      |
| ------------------ | ------------ | ---------------------- |
| Flood City Elite   | `fce`        | `DATABASE_URL`         |
| Fennell Bros.      | `fennell`    | `FENNELL_DATABASE_URL` |

The registry is [`src/lib/tenants.ts`](src/lib/tenants.ts) — each organization's
code, display name, theme, brand mark, and the environment variable holding its
database URL. Those two variables must name **different** databases:
[`src/lib/db.ts`](src/lib/db.ts) refuses to serve a tenant whose connection
string matches another's, and `npm run db:setup` refuses to seed one, so a
copy-paste in `.env.local` fails loudly instead of quietly merging two
organizations into one set of tables.

**Which organization a request belongs to** is resolved in
[`src/middleware.ts`](src/middleware.ts). Two of the sources are *boundaries* —
they decide the answer outright, because they are properties of the address
rather than of the visitor:

1. **`PORTAL_TENANT`** — this deployment serves one organization and no other.
2. The **hostname**, configured with `TENANT_HOSTS`: a comma-separated list of
   `code=hostname` pairs
   (`fennell=portal.fennellbros.com,fce=portal.floodcityelite.com`), or the
   `hosts` array on a tenant in [`src/lib/tenants.ts`](src/lib/tenants.ts).
   Matching is **exact** — list every hostname each organization answers on,
   apex and `www.` alike. An unlisted hostname matches nothing and falls through
   to the default organization, which for a public form means filing a visitor's
   submission under the wrong club, so this is worth getting right.

   > Earlier this guessed, matching a tenant's code against the hostname's
   > dot/dash-separated labels so previews would work unconfigured. It guessed
   > wrong in both directions: `portal.fennellbros.com` contains no `fennell`
   > label, so Fennell's real domain resolved to Flood City Elite — while a
   > Vercel preview URL for a branch named `…fennell-bros…` *did* match, so Flood
   > City Elite's own preview resolved to Fennell and opened their database. A
   > hostname is the boundary between two organizations' data; it is configured,
   > not inferred.

A boundary outranks the session. Somebody arriving at Fennell's address carrying
a Flood City Elite cookie is shown Fennell's sign-in screen and their session is
cleared — it is not another organization's login, so it is not followed to
another organization's portal.

Failing a boundary — a shared deployment on a shared address — the organization
is whatever the visitor is already associated with:

3. the **signed session cookie**, since their company code was checked against a
   password;
4. **`?c=<code>`** in the URL — how a public link names its organization. It is
   per-request and visible in the address bar, and it cannot override a valid
   session;
5. the **tenant cookie**, which carries 4 across a form's POST. It is
   session-scoped and is both written and read only on `/payroll` and
   `/roster-acceptance`, since keeping a form's POST with its GET is the only
   thing it is for. Consulted site-wide it was a hijack waiting to happen: one
   visit to `/payroll?c=fennell`, which an image tag on any page could cause,
   left a cookie that redirected the *next* family's submission into the other
   club's database;
6. failing all of that, the default: `fce`.

Nothing in that chain reads a request body, so a visitor cannot post their way
onto another organization's database.

**Public form links.** On a shared address the two login-free forms carry the
organization in the query string:

| Organization     | Payroll              | Roster spot                    |
| ---------------- | -------------------- | ------------------------------ |
| Flood City Elite | `/payroll`           | `/roster-acceptance`           |
| Fennell Bros.    | `/payroll?c=fennell` | `/roster-acceptance?c=fennell` |

Once an organization has an address of its own the parameter is unnecessary and
is dropped from the links — `portal.fennellbros.com/roster-acceptance` resolves
on the host alone.

### Giving each organization its own URL

Families should see their own club's portal, not a shared platform with a
company-code box on the front. Behind an address of its own — a `PORTAL_TENANT`
deployment or a `TENANT_HOSTS` hostname — the portal drops the company-code
field from the sign-in form, fills the code in server-side, and ignores whatever
was posted, so another organization's code does not work at that address. There
is then nothing on the site to suggest anybody else uses the software.

There are two ways to arrange it:

**One Vercel project, two domains.** Add both domains to the project (Vercel →
**Settings** → **Domains**), set `TENANT_HOSTS`, and leave `PORTAL_TENANT`
blank. One build, one deploy, one set of environment variables; a fix ships to
both organizations at once. The deployment does hold every organization's
connection string, and the two share a Vercel project — invisible to families,
but true.

**One Vercel project per organization.** Import the same repository twice. Each
project gets its own domain, its own `PORTAL_TENANT`, and **only its own**
database URL:

| | Flood City Elite project | Fennell Bros. project |
| --- | --- | --- |
| `PORTAL_TENANT` | `fce` | `fennell` |
| `DATABASE_URL` | Flood City's | *unset* |
| `FENNELL_DATABASE_URL` | *unset* | Fennell's |
| `SESSION_SECRET` | its own | its own (a different one) |

Nothing about the other organization is present in either deployment: not the
connection string, not the session secret, not the build. A session minted by
one is not even valid at the other. The cost is deploying twice and keeping two
sets of environment variables in step.

Either way each organization needs its own `SESSION_SECRET` if you want their
logins to be genuinely unrelated; sharing one means a cookie forged from one
deployment's secret would verify at the other's address (where the boundary
check would still refuse it, but there is no reason to lean on that).

### Setting up Fennell Bros.

1. **Create a second database.** In the Neon console, a *new database* inside the
   same project is enough (**Databases** → **New database**) — it is a separate
   set of tables, which is the whole of what the separation depends on. A
   separate Neon project works just as well.

2. **Point the app at it** in `.env.local`:

   ```bash
   FENNELL_DATABASE_URL=postgresql://…   # must not equal DATABASE_URL
   ```

3. **Create the tables and seed the admin user** in that database:

   ```bash
   npm run db:setup -- --tenant fennell
   ```

   It prints the organization and the variable it read the connection string
   from, so running it once per organization visibly goes to two different
   places, and it prints the generated admin password once.

4. **Sign in** with company code `fennell` and the credentials it printed.

### Adding a third organization

The three steps from [`src/lib/tenants.ts`](src/lib/tenants.ts)'s header comment:

1. create a database for them and put its connection string in a new env var,
2. add an entry to `TENANTS` — code, name, theme, `databaseUrlEnv`, branding,
3. run `npm run db:setup -- --tenant <code>` against the new database.

> [`db/setup.mjs`](db/setup.mjs) keeps its own small copy of that registry, since
> a plain `.mjs` script can't import the TypeScript module — add the new code,
> name, and env var there too, or `--tenant <code>` won't resolve.

## Login credentials

| Field        | Value                                                            |
| ------------ | ---------------------------------------------------------------- |
| Company code | your organization's — `fce` (Flood City Elite) or `fennell` (Fennell Bros.) |
| Username     | `admin` (default seed username)                                  |
| Password     | your `SEED_ADMIN_PASSWORD`, or a strong random one generated and printed once by `npm run db:setup` |

> The company code is what picks the database the sign-in is checked against, so
> it is per organization — see [Organizations](#organizations-multi-tenant) for
> the current list. Each organization has its own admin user, seeded by its own
> `npm run db:setup -- --tenant <code>` run. The admin password is never
> hardcoded — set your own via `SEED_ADMIN_PASSWORD` or use the one the seed step
> prints, and change it after first login.

## Database tables

Several tables back the app (see [`db/schema.sql`](db/schema.sql)). They exist
**once per organization, in that organization's own database** — the schema is
applied to each one separately, so every table below is really a set of tables
per tenant and none of them is shared. The core ones are:

- **`companies`** — the organization this database belongs to. Login matches on
  `code` (`fce`, `fennell`), and since a database holds one organization it
  holds one row: the code identifies which database to check the sign-in
  against, not which subset of a shared table to read.
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

  **New / Returning.** The roster's next column labels each player — a green
  **Returning** pill, a blue **New** one. It reads from two places, in order:
  `players.is_returning`, the coach's own setting on the add/edit player form,
  and failing that the acceptance form's *"Did you play in 2026?"* answer on
  their accepted `roster_submissions` row. Set nothing and it simply tracks what
  the parent said; set it and yours wins. A player added by hand or through a
  bulk upload has neither until someone sets it, so the cell shows an em dash
  rather than guessing at "new". Each pill's tooltip says which of the two it's
  coming from.

  The override is a column on `players` rather than an edit to the submission on
  purpose: that row records what the parent actually said, and the jersey
  automation reads `played_fce_2026` to decide who keeps a returning number —
  editing it from the roster would quietly reshuffle jersey numbers. Clearing
  the field on the editor (choosing *From the acceptance form*) hands the player
  back to the form's answer. The column prints with the roster, as plain words,
  since colour doesn't survive a mono printer.

  **View Field.** Each team on the Teams tab has a **View Field** button that
  opens a diamond with every player placed at their primary position (solid
  dot) and secondary position (hollow dot), so stacked and thin spots read at a
  glance. Positions are free text, so
  [`field-positions.ts`](src/app/(app)/teams/field-positions.ts) maps what
  coaches actually type (`3rd base`, `3rd`, `Short`, `SS`…) onto the nine
  fielding spots. Anything it can't place confidently — DH, utility, a generic
  `OF`, a typo, or a blank — is listed under the field as typed instead of being
  guessed onto a spot, since a wrong placement would quietly skew the counts the
  view exists to show. (Bare numbers are deliberately not mapped: `6` could be
  scorer's notation for shortstop or a half-typed ordinal.) **Print / Save PDF**
  in that view opens `/teams/print/field`, which renders the same diagram —
  identical components, repainted for white paper — one team per portrait page.
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
- **`fixed_cost_sections`**, **`fixed_cost_items`**, **`fixed_cost_settings`** —
  the **Fixed Cost** tab: what the program pays for up front regardless of which
  team a player lands on (uniforms, insurance, facility time). A *section* is a
  group the user names; an *item* is one cost inside it. The total divided by
  the player count is the **fixed cost per player**, and that's what ties this
  tab to Budgets.

  Costs are kept **per season year**, picked with the same year pills the Teams
  and Budgets tabs use — `season_year` on the section rather than a
  `seasons(id)`, because a season row is one *division's* run while insurance
  and uniforms are bought once for the whole program. So one year's sheet feeds
  every division's budgets for that year, and each year carries its own player
  count (`fixed_cost_settings` is keyed by company **and** year). A sheet
  written before the year existed is migrated onto the company's active season
  year, so nothing disappears.

  The tie to Budgets: 

  ```
  portion to team budget = tuition per player − fixed cost per player
  ```

  so raising a fixed cost lowers every team's starting balance without anyone
  retyping a number. The divisor is the players marked **Paying** on the active
  seasons' rosters, with `fixed_cost_settings.player_count` as an optional
  manual override (mirroring the Budgets tab's paying-player field).

  On the Budgets sheet the fixed cost per player shows as its own deduction row,
  and `team_budgets.portion_to_team_budget` is now **nullable**: NULL means
  "derive it" and a saved number is a deliberate per-team override. Budgets
  written before this tab existed carry a number, so they keep behaving exactly
  as they did until that field is cleared. Homeplate's at-risk balances and the
  Budgets print view resolve the portion the same way.
- **`fundraisers`**, **`fundraiser_entries`** — the **Fundraiser Tracker** tab.
  A *fundraiser* is a campaign a company runs (e.g. "Spring Car Wash"), with an
  optional goal and date; an *entry* is money raised toward it, logged against a
  team (`team_id`) and, for a player-based fundraiser, a player (`player_id`;
  NULL means the whole team raised it).

  The tie to Budgets: **every entry is credited to that team's budget.** A
  team's raised total is the sum of its entries, and:

  ```
  current balance = starting balance − scheduled cost − expenses + fundraising raised
  ```

  so logging a fundraiser entry is an immediate uptick in the team's balance —
  the sheet shows it as a **Fundraising raised** credit row with the entries
  itemized beside it, and the *Fundraising amount needed per player* row is what
  is **still** needed, net of what's already in. Both kinds of entry count the
  same: a player-level one is that player's share of their team's money.

  Entries are scoped to the budget through their team, and a team belongs to one
  season, so a season's sheet only ever credits what was raised for it. Logging
  or deleting an entry (or deleting a fundraiser, which cascades to its entries)
  refreshes the Budgets tab and Homeplate alongside the tracker, and Homeplate's
  at-risk list and the Budgets print view credit the same total — a team that
  fundraises its way back out of the red drops off the watch list.
- **`college_coaches`** — the **Contact Info** tab, a recruiting contact book
  for college programs. The tab is split by `sport` (`baseball` or `softball`,
  the same two values a team carries), so each sport keeps its own list and the
  sub-tabs show a count. Only `school_name` is required; `coach_name`,
  `coach_title`, `division_level` (D1/D2/D3/NAIA/JUCO — a datalist of the common
  ones, but free text), `conference`, `cell_phone`, `email`, `website`, `city`,
  `state`, and `notes` fill in as a program gets worked. In the table the phone,
  email, and website are tap-to-open links (a website typed without a scheme
  gets `https://`; anything that isn't an http(s) link stays plain text), and a
  search box plus a division-level filter narrow the list. Rows are edited
  inline — the editor also carries the Sport, so a contact filed under the wrong
  list can be moved. Belongs to a company via `company_id`.
- **`hotels`** — the **Hotels** tab, the program's travel list. Built like
  Contact Info: an add form over a searchable table whose rows edit inline.
  Only `name` is required; `address`, `city`, `state`, `avg_cost_per_night`
  (the nightly room rate), `phone`, `website`, and `notes` fill in as a stay is
  booked. Two dropdown columns tie a stay to the rest of the app: `division` (a
  teams division slug, or null) and `event_id` — the **Schedules**-tab
  tournament the stay is for. `event_name` snapshots that tournament's name, so
  deleting it from the Schedules tab (which nulls `event_id`) leaves the hotel
  still showing what it was booked for instead of losing the context. A live
  tournament's cell links through to its Schedules view. The list can be
  filtered by division and by tournament, and the count line averages the
  nightly rate across whatever is in view. Belongs to a company via
  `company_id`.
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
  decision; the division + team the offer was for are required either way (so a
  decline shows which team's spot was turned down), and a decline records just
  that plus the `player_name`, while an accept also carries the player's details
  and the parent's contact info. When a parent
  accepts, the player is pushed onto the chosen team's roster in the same write
  — `player_id` links to that `players` row, and `team_name`/`division` snapshot
  the choice so it survives the team being deleted (which nulls `team_id`). The
  accept also copies the player's high school and hat size, and the parent's
  name, onto the roster row.
  **Export.** The tab's ⬇ CSV / ⬇ Excel buttons download the responses as a
  spreadsheet — one row per response, one column per question, blank where a
  parent didn't answer. The download honours the tab's search, status, and team
  filters: the buttons carry them to `/roster-submissions/export`, which
  re-applies the *same* predicates the list uses (both import them from
  [`submissions.ts`](<src/app/(app)/roster-submissions/submissions.ts>)), so the
  file holds exactly the rows that were on screen. CSV values that open with
  `=`, `+`, `-`, or `@` are prefixed with an apostrophe so a spreadsheet treats
  what a parent typed as text rather than a formula; the `.xlsx` needs no such
  guard, since its cells are written as strings and Excel only evaluates cells
  actually typed as formulas.

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
  that isn't already taken. The reconcile runs inside one Postgres function
  (`fce_recompute_team_jerseys`) under a per-team advisory lock, so simultaneous
  acceptances can't race into a duplicate number. Numbers that are fixed —
  players added by hand on the Teams tab (no submission), and any number a coach
  sets on the Teams-tab edit (which flips `players.jersey_locked`) — are treated
  as taken and never reassigned; a player whose options are all taken is left
  blank, and once the coach fills it in it stays put.

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment** — copy the example and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   - `DATABASE_URL` — Flood City Elite's Neon connection string (Neon console →
     **Connect** → pooled connection string).
   - `SESSION_SECRET` — a random secret: `openssl rand -base64 32`.
   - `FENNELL_DATABASE_URL` — only if you're running Fennell Bros. too; it is a
     *different* database (see [Organizations](#organizations-multi-tenant)).

3. **Create the tables and seed the admin user**

   ```bash
   npm run db:setup
   ```

   This creates the tables, ensures the `fce` company exists, and creates the
   default admin user. It prints the credentials when it finishes.

   Each organization has its own database, so this is run once per organization,
   naming the one it targets — `npm run db:setup -- --tenant fennell` does the
   same against `FENNELL_DATABASE_URL`. With no `--tenant` it targets `fce`.

   > Prefer to do it by hand? Paste [`db/schema.sql`](db/schema.sql) into the
   > Neon **SQL Editor** instead, connected to that organization's database —
   > then insert its `companies` row and a user with a bcrypt hash.

4. **Run the app**

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000> and sign in.

## Adding more users

Each user belongs to a company, in that organization's own database — so run the
insert against the database of the organization the user is joining, matching on
its code (`fce` below, `fennell` for Fennell Bros.). Insert a row into `users`
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
