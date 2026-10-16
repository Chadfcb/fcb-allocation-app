// Ernie's live maps — what's in the database and which pages exist — for the
// person he's talking to (added 2026-10-16, per Chad — project doc
// claude/ernie-live-data-map-plan.md).
//
// Why: Ernie used to work from a HAND-WRITTEN list of tables in his query
// tool's description. Anything built after that list was last edited was
// invisible to him — that's how he told Chad Matagrano's store-level sales
// "aren't something we have visibility into" while Sales > Accounts had
// exactly that. Now, at the start of every reply:
//
//   * the data map comes from the database itself (sql/ernie_data_map.sql →
//     ernie_data_map()), filtered by THIS person's own access, with each
//     table's plain-English description (its COMMENT). New tables appear
//     automatically.
//   * the page map comes from lib/appPages.ts — the same list the Sidebar
//     draws — filtered by the same access rules.
//
// The output only changes when the database or someone's access changes, so
// it doesn't break the system prompt's 1-hour prompt cache.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types/db";
import type { AnySectionKey } from "@/lib/permissions";
import { pagesForErnie } from "@/lib/appPages";

type MapEntry = {
  name: string;
  kind: "table" | "view" | "function";
  access: "all" | "own";
  description: string;
  columns: string | null;
};

// Shorter type names — the map is read on every reply, so every word counts.
function shortTypes(cols: string): string {
  return cols
    .replace(/timestamp with time zone/g, "timestamptz")
    .replace(/timestamp without time zone/g, "timestamp")
    .replace(/character varying(\(\d+\))?/g, "text")
    .replace(/double precision/g, "float")
    .replace(/numeric\(\d+,\d+\)/g, "numeric")
    .replace(/ boolean/g, " bool")
    .replace(/ integer/g, " int");
}

function formatDataMap(entries: MapEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    const tags = [
      e.kind === "view" ? "view" : null,
      e.access === "own" ? "only this person's own rows" : null,
    ].filter(Boolean);
    const head = `- ${e.name}${tags.length ? ` [${tags.join(", ")}]` : ""}`;
    const desc = e.description ? `: ${e.description}` : "";
    const cols = e.columns ? `\n    ${e.kind === "function" ? "" : "columns: "}${shortTypes(e.columns)}` : "";
    lines.push(`${head}${desc}${cols}`);
  }
  return lines.join("\n");
}

/**
 * The "WHAT'S IN THE DATABASE" and "PAGES" sections of Ernie's instructions.
 * `includeData` false = no data map (e.g. Slack when Ernie couldn't sign in
 * as the person and has no query tool — listing tables he can't query would
 * only mislead him).
 */
export async function buildErnieMaps(
  supabase: SupabaseClient,
  role: Role | undefined,
  sections: AnySectionKey[],
  isSuperAdmin = false,
  includeData = true,
): Promise<string> {
  const parts: string[] = [];

  if (includeData) {
    const { data, error } = await supabase.rpc("ernie_data_map");
    if (error || !Array.isArray(data)) {
      parts.push(
        `WHAT'S IN THE DATABASE FOR THIS PERSON: the live data map couldn't be loaded this time (${
          error?.message ?? "no data"
        }). Before answering from the database, list the tables yourself with run_read_only_query (see its description for the exact query) — don't assume a table doesn't exist.`,
      );
    } else {
      parts.push(
        `WHAT'S IN THE DATABASE FOR THIS PERSON — every table, view and function they can read, built live from the database on this reply (complete and current, not a hand-made list). Each note says what the table holds and which questions it answers; read the notes, not just the names — the right table often uses different words than the question. Query with run_read_only_query using these exact names. Functions are called inside a SELECT, e.g. select * from sales_product_options().\n${formatDataMap(
          data as MapEntry[],
        )}`,
      );
    }
  }

  const pages = pagesForErnie(role, sections, isSuperAdmin);
  if (pages.length) {
    parts.push(
      `PAGES THIS PERSON CAN OPEN (open_app_page with the path; from the same list as the app's left menu):\n${pages
        .map((p) => `- ${p}`)
        .join("\n")}`,
    );
  }

  return parts.join("\n\n");
}
