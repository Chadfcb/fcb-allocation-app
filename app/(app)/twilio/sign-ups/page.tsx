import { createClient } from "@/lib/supabase/server";
import TwilioSignupsClient, { type SmsContactRow } from "@/components/TwilioSignupsClient";

// Twilio → Text Sign-ups (added 2026-10-29, per Chad): everyone who agreed to
// FCB new-item texts (texted JOIN, or used the /sms-signup form) and everyone
// who opted out (STOP). This is FCB's consent record. Rows are only ever
// created by Twilio / the sign-up form; here you can fill in name, business,
// rep and notes and link the account. Access: the "twilio" section.
export const dynamic = "force-dynamic";

export default async function TwilioSignupsPage() {
  const supabase = await createClient();
  const { data: contacts, error } = await supabase
    .from("sms_contacts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);

  // Names of linked accounts, for display.
  const outletIds = [...new Set((contacts ?? []).map((c) => c.outlet_id).filter(Boolean))] as string[];
  const accountNames: Record<string, string> = {};
  if (outletIds.length) {
    const { data: accts } = await supabase.from("sales_accounts").select("outlet_id, name").in("outlet_id", outletIds);
    for (const a of accts ?? []) accountNames[a.outlet_id] = a.name;
  }

  return (
    <TwilioSignupsClient
      initial={(contacts ?? []) as SmsContactRow[]}
      accountNames={accountNames}
      loadError={error ? error.message : null}
    />
  );
}
