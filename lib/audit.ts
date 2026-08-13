import type { SupabaseClient } from "@supabase/supabase-js";

// Records a single-field change to the audit log so it shows up in the
// admin audit trail and can be one-click undone later. Call this right
// after a successful update/upsert with the value as it was *before* your
// change and the value you just wrote.
export async function logChange(
  supabase: SupabaseClient,
  params: {
    weekId: string | null;
    tableName: string;
    recordId: string;
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
    changedBy: string;
  }
) {
  const { weekId, tableName, recordId, fieldName, oldValue, newValue, changedBy } = params;

  // Skip logging no-op changes.
  if (String(oldValue ?? "") === String(newValue ?? "")) return;

  await supabase.from("audit_log").insert({
    week_id: weekId,
    table_name: tableName,
    record_id: recordId,
    field_name: fieldName,
    old_value: oldValue === null || oldValue === undefined ? null : String(oldValue),
    new_value: newValue === null || newValue === undefined ? null : String(newValue),
    changed_by: changedBy,
  });
}
