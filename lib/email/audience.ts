import type { SupabaseClient } from "@supabase/supabase-js";

// Email Studio — who an email goes to (added 2026-10-30). Server-only; call
// with the service-role client AFTER the email_studio access check (Eddie
// doesn't have the Accounts section, but needs account contact emails here).
//
// An audience = account contacts (optionally filtered by distributor,
// premise, recent buying) + any saved lists (e.g. the Mailchimp import) +
// extra addresses typed in. Everyone on the do-not-email list
// (email_suppressions) is always removed. One email per address.

export type Audience = {
  accounts: {
    enabled: boolean;
    distributors?: string[]; // empty/undefined = all
    premises?: string[]; // empty/undefined = all
    boughtWithinDays?: number | null; // e.g. 90 = bought in the last 90 days
  };
  listIds?: string[];
  extraEmails?: string[];
};

export type Recipient = { email: string; name: string | null; business: string | null; outlet_id: string | null };

export type AudienceResult = {
  recipients: Recipient[];
  counts: { fromAccounts: number; fromLists: number; fromExtra: number; suppressed: number; invalid: number; total: number };
};

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/i;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  return EMAIL_RE.test(e) ? e : null;
}

async function readAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Distinct distributors / premise values for the audience picker. */
export async function audienceOptions(admin: SupabaseClient) {
  const accounts = await readAll<{ distributor: string | null; premise: string | null }>((a, b) =>
    admin.from("sales_accounts").select("distributor, premise").range(a, b),
  );
  const distributors = [...new Set(accounts.map((a) => a.distributor?.trim()).filter(Boolean) as string[])].sort();
  const premises = [...new Set(accounts.map((a) => a.premise?.trim()).filter(Boolean) as string[])].sort();
  const { data: lists } = await admin.from("email_lists").select("id, name, source").order("created_at", { ascending: false });
  return { distributors, premises, lists: lists ?? [] };
}

export async function resolveAudience(admin: SupabaseClient, audience: Audience): Promise<AudienceResult> {
  const byEmail = new Map<string, Recipient>();
  let invalid = 0;
  let fromAccounts = 0;
  let fromLists = 0;
  let fromExtra = 0;

  if (audience.accounts?.enabled) {
    const accounts = await readAll<{ outlet_id: string; name: string; distributor: string | null; premise: string | null; last_buy_date: string | null }>(
      (a, b) => admin.from("sales_accounts").select("outlet_id, name, distributor, premise, last_buy_date").range(a, b),
    );
    const dists = (audience.accounts.distributors ?? []).filter(Boolean);
    const prems = (audience.accounts.premises ?? []).filter(Boolean);
    const cutoff = audience.accounts.boughtWithinDays
      ? new Date(Date.now() - audience.accounts.boughtWithinDays * 86400000).toISOString().slice(0, 10)
      : null;
    const allowed = new Map<string, string>();
    for (const a of accounts) {
      if (dists.length && !dists.includes(a.distributor?.trim() ?? "")) continue;
      if (prems.length && !prems.includes(a.premise?.trim() ?? "")) continue;
      if (cutoff && (!a.last_buy_date || a.last_buy_date < cutoff)) continue;
      allowed.set(a.outlet_id, a.name);
    }
    const contacts = await readAll<{ outlet_id: string; name: string | null; email: string | null }>((a, b) =>
      admin.from("sales_account_contacts").select("outlet_id, name, email").not("email", "is", null).range(a, b),
    );
    for (const c of contacts) {
      if (!allowed.has(c.outlet_id)) continue;
      // A contact's email cell sometimes holds two addresses.
      for (const part of (c.email ?? "").split(/[;,\s]+/).filter(Boolean)) {
        const e = normalizeEmail(part);
        if (!e) {
          invalid++;
          continue;
        }
        if (!byEmail.has(e)) {
          byEmail.set(e, { email: e, name: c.name?.trim() || null, business: allowed.get(c.outlet_id) ?? null, outlet_id: c.outlet_id });
          fromAccounts++;
        }
      }
    }
  }

  const listIds = (audience.listIds ?? []).filter(Boolean);
  if (listIds.length) {
    const members = await readAll<{ email: string; name: string | null; business: string | null }>((a, b) =>
      admin.from("email_list_members").select("email, name, business").in("list_id", listIds).range(a, b),
    );
    for (const m of members) {
      const e = normalizeEmail(m.email);
      if (!e) {
        invalid++;
        continue;
      }
      if (!byEmail.has(e)) {
        byEmail.set(e, { email: e, name: m.name, business: m.business, outlet_id: null });
        fromLists++;
      }
    }
  }

  for (const raw of audience.extraEmails ?? []) {
    const e = normalizeEmail(raw);
    if (!e) {
      if (raw.trim()) invalid++;
      continue;
    }
    if (!byEmail.has(e)) {
      byEmail.set(e, { email: e, name: null, business: null, outlet_id: null });
      fromExtra++;
    }
  }

  const suppressed = new Set(
    (await readAll<{ email: string }>((a, b) => admin.from("email_suppressions").select("email").range(a, b))).map((s) => s.email.toLowerCase()),
  );
  let suppressedCount = 0;
  const recipients: Recipient[] = [];
  for (const r of byEmail.values()) {
    if (suppressed.has(r.email)) suppressedCount++;
    else recipients.push(r);
  }
  recipients.sort((a, b) => (a.business ?? "~").localeCompare(b.business ?? "~") || a.email.localeCompare(b.email));

  return {
    recipients,
    counts: { fromAccounts, fromLists, fromExtra, suppressed: suppressedCount, invalid, total: recipients.length },
  };
}
