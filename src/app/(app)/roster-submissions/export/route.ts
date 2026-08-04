import { getSession } from "@/lib/session";
import {
  ensureRosterSubmissionsSchema,
  listRosterSubmissions,
  type RosterSubmissionRow,
} from "@/lib/roster-submissions";
import { ensureTeamsSchema } from "../../teams/schema";
import { listDivisionsSafe } from "../../teams/division-store";
import type { Division } from "../../teams/divisions";
import {
  exportColumns,
  haystackOf,
  isStatusFilter,
  matchesSearchAndTeam,
  matchesStatus,
  teamKeyOf,
  toCsv,
} from "../submissions";

// Download the roster responses as a spreadsheet.
//
// The tab's search, status, and team filters ride along as query params and are
// re-applied here with the very same predicates the list uses, so the file
// holds exactly the rows that were on screen. Never cached — the download must
// reflect the responses as they stand right now.
export const dynamic = "force-dynamic";

// Deterministic YYYY-MM-DD (UTC) for the filename.
function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function toXlsx(
  rows: RosterSubmissionRow[],
  columns: ReturnType<typeof exportColumns>,
): Promise<ArrayBuffer> {
  // Loaded dynamically, the way the roster bulk-upload does, so exceljs stays
  // out of the bundle until a download is actually asked for.
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Roster Submissions");

  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.header,
    width: c.width,
  }));

  for (const row of rows) {
    // Written as plain strings: nothing here is ever a formula, whatever a
    // parent typed into the public form.
    sheet.addRow(columns.map((c) => c.value(row)));
  }

  const header = sheet.getRow(1);
  header.font = { bold: true };
  // Freeze the header and turn on filter arrows — the two things anyone does
  // first with an export this wide.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "xlsx" ? "xlsx" : "csv";
  const query = params.get("q") ?? "";
  const statusRaw = params.get("status") ?? "all";
  const status = isStatusFilter(statusRaw) ? statusRaw : "all";
  const teamFilter = params.get("team") ?? "";

  let rows: RosterSubmissionRow[];
  // The company's divisions, so the Division column and the search this export
  // re-applies name a division the way the tab does.
  let divisions: Division[] = [];
  try {
    await ensureTeamsSchema();
    await ensureRosterSubmissionsSchema();
    divisions = await listDivisionsSafe(session.companyId);
    const all = await listRosterSubmissions(session.companyId);
    rows = all.filter(
      (s) =>
        matchesSearchAndTeam(
          query,
          teamFilter,
          haystackOf(s, divisions),
          teamKeyOf(s),
        ) &&
        matchesStatus(s.accepted, status),
    );
  } catch (err) {
    console.error("Roster submissions export error:", err);
    return new Response("Could not build the export. Please try again.", {
      status: 500,
    });
  }

  const filename = `roster-submissions-${todayStamp()}.${format}`;
  // Every signed-in user hits the same URL for their own company's responses,
  // and this file is personal data. Without no-store a shared cache keyed on
  // the URL could hand one company's export to the next person who asks —
  // Next's Vary header covers its router headers, not the session cookie — and
  // the browser could re-serve a stale file after new responses arrive.
  const headers = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store, private",
  };

  if (format === "xlsx") {
    return new Response(await toXlsx(rows, exportColumns(divisions)), {
      headers: {
        ...headers,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  }

  // A UTF-8 BOM so Excel reads accented names correctly instead of mojibake.
  return new Response(`﻿${toCsv(rows, divisions)}`, {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
  });
}
