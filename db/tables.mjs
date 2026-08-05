// ---------------------------------------------------------------------------
// Show what is in each organization's database.
//
//   npm run db:tables                     # every organization that is configured
//   npm run db:tables -- --tenant fennell # just that one
//
// Prints the tables and their row counts, and — the part worth reading — the
// host and database name each organization's connection string actually lands
// on. Two organizations showing the same one would mean their rows share tables,
// which is the thing this whole arrangement exists to prevent, so the script
// says so loudly rather than leaving it to be noticed.
//
// Read-only: it runs SELECTs and nothing else.
// ---------------------------------------------------------------------------

import { neon } from "@neondatabase/serverless";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // file not present — ignore and try the next one
  }
}

// A mirror of the tenant registry in `src/lib/tenants.ts`, which is the source
// of truth — same as db/setup.mjs. Adding an organization there means adding it
// here too.
const TENANTS = {
  fce: { name: "Flood City Elite", databaseUrlEnv: "DATABASE_URL" },
  fennell: { name: "Fennell Bros.", databaseUrlEnv: "FENNELL_DATABASE_URL" },
};

function parseTenantCode(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant") {
      const value = argv[i + 1];
      return value && !value.startsWith("--") ? value : "";
    }
    if (arg.startsWith("--tenant=")) return arg.slice("--tenant=".length);
  }
  return process.env.TENANT || null;
}

// Where a connection string actually lands, ignoring credentials and query
// parameters — the same reduction `src/lib/db.ts` compares on, so two spellings
// of one database are recognised as one database.
function databaseIdentity(url) {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\/+/, "").toLowerCase();
    return database ? `${parsed.hostname.toLowerCase()}/${database}` : null;
  } catch {
    return null;
  }
}

// Exact row counts for every table in one query. `query_to_xml` runs the
// count per table inside Postgres, which avoids building SQL per table name out
// here — and unlike the planner statistics in pg_stat_user_tables, the numbers
// are current rather than however stale the last ANALYZE left them.
const TABLE_QUERY = `
  SELECT
    t.table_name,
    (xpath(
      '/row/cnt/text()',
      query_to_xml(
        format('SELECT count(*) AS cnt FROM %I.%I', t.table_schema, t.table_name),
        false, true, ''
      )
    ))[1]::text::bigint AS row_count
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name
`;

async function report(code) {
  const tenant = TENANTS[code];
  const url = process.env[tenant.databaseUrlEnv]?.trim();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${tenant.name}  (company code: ${code})`);
  console.log(`${"─".repeat(60)}`);

  if (!url) {
    console.log(`  ${tenant.databaseUrlEnv} is not set — no database yet.`);
    console.log(
      `  Create one, set ${tenant.databaseUrlEnv}, then:  npm run db:setup -- --tenant ${code}`,
    );
    return null;
  }

  const identity = databaseIdentity(url);
  console.log(`  ${tenant.databaseUrlEnv} → ${identity ?? "(unparseable URL)"}`);

  let rows;
  try {
    // `.query()` rather than the tagged-template form: this is a fixed SQL
    // string with no interpolated values, which the template form rejects.
    rows = await neon(url).query(TABLE_QUERY);
  } catch (err) {
    console.log(`  ✖  Could not read it: ${err.message}`);
    return identity;
  }

  if (rows.length === 0) {
    console.log(
      `  No tables yet. Run:  npm run db:setup -- --tenant ${code}`,
    );
    return identity;
  }

  const width = Math.max(...rows.map((r) => r.table_name.length));
  for (const row of rows) {
    console.log(
      `    ${row.table_name.padEnd(width)}  ${String(row.row_count).padStart(7)}`,
    );
  }
  console.log(`  ${rows.length} tables`);
  return identity;
}

async function main() {
  const requested = parseTenantCode(process.argv.slice(2));
  const code = requested === null ? null : requested.trim().toLowerCase();

  if (code !== null && !TENANTS[code]) {
    console.error(
      `\n✖  Unknown organization ${JSON.stringify(code)}.\n` +
        `   Known codes: ${Object.keys(TENANTS).join(", ")}.\n`,
    );
    process.exit(1);
  }

  const codes = code === null ? Object.keys(TENANTS) : [code];
  const identities = new Map();

  for (const c of codes) {
    const identity = await report(c);
    if (identity) {
      if (identities.has(identity)) identities.get(identity).push(c);
      else identities.set(identity, [c]);
    }
  }

  console.log();
  let shared = false;
  for (const [identity, sharers] of identities) {
    if (sharers.length > 1) {
      shared = true;
      console.error(
        `✖  ${sharers.join(" and ")} both point at ${identity}.\n` +
          `   Their rows would share tables. Give each its own database.`,
      );
    }
  }

  if (!shared && identities.size > 1) {
    console.log(
      `✔  ${identities.size} organizations, ${identities.size} separate databases — no shared tables.`,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error("\n✖  Failed:", err.message, "\n");
  process.exit(1);
});
