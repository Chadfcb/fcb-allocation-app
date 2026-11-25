import type { SupabaseClient } from "@supabase/supabase-js";

// Email Studio — telling distributor staff apart from account contacts
// (added 2026-11-25, per Chad: "we dont want these sent to the matagrano
// people. Only to accounts" … "or markstein people" … "distributoir contacts
// should be its own selection, not included in the other selections").
// Server-only.
//
// A contact counts as DISTRIBUTOR STAFF (never sent under "Account contacts";
// only under the separate "Distributor contacts" choice) when any of these:
//   1. Their address is at a distributor's email domain (below, plus any
//      domain used by a distributor's own people on the Contacts button).
//   2. They're one of a distributor's own people (distributor_contacts), by
//      email or by full name (catches a personal Gmail on another account).
//   3. They're on a "distributor" account — e.g. DISTRIBUTOR VISIT MATAGRANO
//      INC., MARKSTEIN BEVERAGE COMP, VALLEY WIDE BEVERAGE SP.
// Our own people (FCB, CMC) are never "account contacts" either.

/** Distributor email domains (lowercase). */
export const DISTRIBUTOR_DOMAINS = [
  "matagrano.com",
  "markstein1919.com",
  "markstein.com",
  "valleywidebeverage.com",
  "mussetterdistributing.com",
  "saccanidist.com",
  "call4bud.com",
];

/** Our own / our agency's domains — not accounts, not distributors. */
export const OWN_DOMAINS = ["fullcirclebrewing.com", "fcbbrands.com", "choosecmc.com"];

const FREE_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "comcast.net", "sbcglobal.net", "att.net", "live.com", "msn.com", "ymail.com"]);

/** A distributor's own account (staff visits, warehouses), by its name. */
export function isDistributorAccountName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  return /distributor visit/i.test(n) || /^(matagrano|markstein|mussetter|saccani|valley wide)\b/i.test(n);
}

const domainOf = (email: string) => email.split("@")[1] ?? "";
const nameKey = (name: string | null | undefined) => {
  const k = (name ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return k.split(" ").length >= 2 ? k : ""; // full names only
};

export type StaffIndex = {
  /** True when this address / name is distributor staff or our own people. */
  isStaff: (email: string, name?: string | null, accountName?: string | null) => boolean;
  /** Each distributor's own people with an email: { email, name, distributor }. */
  people: { email: string; name: string | null; distributor: string }[];
};

/** Reads distributor_contacts once and returns the staff test. */
export async function loadStaffIndex(
  admin: SupabaseClient,
  normalize: (raw: string | null | undefined) => string | null,
): Promise<StaffIndex> {
  const { data } = await admin.from("distributor_contacts").select("distributor, name, email");
  const domains = new Set([...DISTRIBUTOR_DOMAINS, ...OWN_DOMAINS]);
  const emails = new Set<string>();
  const names = new Set<string>();
  const people: StaffIndex["people"] = [];
  for (const p of (data ?? []) as { distributor: string; name: string | null; email: string | null }[]) {
    const k = nameKey(p.name);
    if (k) names.add(k);
    for (const part of (p.email ?? "").split(/[;,\s]+/)) {
      const e = normalize(part);
      if (!e) continue;
      emails.add(e);
      const d = domainOf(e);
      if (d && !FREE_DOMAINS.has(d)) domains.add(d);
      people.push({ email: e, name: p.name?.trim() || null, distributor: p.distributor });
    }
  }
  return {
    people,
    isStaff: (email, name, accountName) => {
      if (domains.has(domainOf(email))) return true;
      if (emails.has(email)) return true;
      const k = nameKey(name);
      if (k && names.has(k)) return true;
      if (isDistributorAccountName(accountName)) return true;
      return false;
    },
  };
}
