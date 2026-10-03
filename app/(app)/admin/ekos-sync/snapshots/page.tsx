import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin → Ekos Sync → Snapshots (added 2026-10-03). Shows every step one
// "Run now + snapshots" recorded: screenshot, page/frames text, tables and
// the Ekos requests made. Admins only. See lib/syncs/snapshots.ts.
export const dynamic = "force-dynamic";

interface SnapRow {
  run_group: string;
  step: number;
  label: string;
  details: Record<string, unknown>;
  image_path: string | null;
  created_at: string;
}

export default async function SnapshotsPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { group } = await searchParams;
  const admin = createAdminClient();

  if (!group) {
    const { data } = await admin
      .from("sync_snapshots")
      .select("run_group, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const groups: { id: string; at: string; steps: number }[] = [];
    for (const r of (data as { run_group: string; created_at: string }[] | null) ?? []) {
      const g = groups.find((x) => x.id === r.run_group);
      if (g) g.steps += 1;
      else groups.push({ id: r.run_group, at: r.created_at, steps: 1 });
    }
    return (
      <div className="flex flex-col gap-4">
        <Link href="/admin/ekos-sync" className="text-sm text-neutral-400 hover:underline">
          ← Ekos Sync
        </Link>
        <h1 className="text-xl font-semibold text-neutral-100">Snapshot runs</h1>
        {groups.length === 0 ? (
          <p className="text-sm text-neutral-500">None yet. Use &ldquo;Run now + snapshots&rdquo; on the Ekos Sync page.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {groups.map((g) => (
              <li key={g.id}>
                <Link href={`/admin/ekos-sync/snapshots?group=${g.id}`} className="text-brand hover:underline">
                  {new Date(g.at).toLocaleString()}
                </Link>{" "}
                <span className="text-neutral-500">· {g.steps} steps</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const { data } = await admin
    .from("sync_snapshots")
    .select("run_group, step, label, details, image_path, created_at")
    .eq("run_group", group)
    .order("step");
  const rows = (data as SnapRow[] | null) ?? [];
  const urls: Record<string, string> = {};
  for (const r of rows) {
    if (!r.image_path) continue;
    const { data: signed } = await admin.storage.from("sync-snapshots").createSignedUrl(r.image_path, 60 * 60);
    if (signed?.signedUrl) urls[r.image_path] = signed.signedUrl;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/ekos-sync/snapshots" className="text-sm text-neutral-400 hover:underline">
        ← All snapshot runs
      </Link>
      <h1 className="text-xl font-semibold text-neutral-100">
        Snapshot run {rows[0] ? new Date(rows[0].created_at).toLocaleString() : ""}
      </h1>
      {rows.map((r) => (
        <section key={r.step} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
          <h2 className="text-sm font-semibold text-neutral-100">
            {r.step}. {r.label}
          </h2>
          {r.image_path && urls[r.image_path] && (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
            <img src={urls[r.image_path]} alt={r.label} className="max-w-full rounded border border-neutral-800" />
          )}
          <details>
            <summary className="cursor-pointer text-xs text-neutral-400">Details (page, frames, tables, Ekos requests)</summary>
            <pre className="mt-2 max-h-[600px] overflow-auto whitespace-pre-wrap break-words text-xs text-neutral-300">
              {JSON.stringify(r.details, null, 2)}
            </pre>
          </details>
        </section>
      ))}
    </div>
  );
}
