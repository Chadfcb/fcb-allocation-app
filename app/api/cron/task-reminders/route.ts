import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/sendMail";

// Task due-date email reminders (2026-09-05, per Chad: "we need the push
// notification to happen the day before it is due, and the day it is due
// on, they need to happen at 8am pst").
//
// Trigger, reworked 2026-09-10 (per Chad, after two real tasks' reminders
// silently never fired): this route is no longer invoked by Vercel's own
// Cron feature. Vercel's docs describe Cron delivery as "best effort" —
// an invocation can just not happen, with no error and no log entry at
// all — which is exactly what we now believe happened here (confirmed:
// both notified_* columns were still null for a task whose due-date
// window had already passed, and the code/deploy history ruled out every
// other explanation). Per Chad, "0 faith in vercel" for this specific
// piece and not interested in paying for Vercel Pro's more precise Cron —
// so this endpoint is now expected to be called by an external scheduler
// (e.g. cron-job.org) hitting this URL with the same `Authorization:
// Bearer <CRON_SECRET>` header Vercel used to send automatically. See
// task-reminders-setup.md for the external-scheduler setup steps. The
// `vercel.json` cron entry can be left in place harmlessly as a backup
// trigger (redundant invocations are safe — see the catch-up note below)
// or removed; it's no longer load-bearing either way.
//
// Each task is only ever emailed once per milestone — task_items.
// notified_day_before_at / notified_due_day_at record that it's been sent,
// checked before sending and set right after (sql/task_due_reminders.sql).
//
// Catch-up, added 2026-09-10: the ORIGINAL version of this route only ever
// matched a task whose due_date was EXACTLY today (or exactly tomorrow,
// for the day-before heads-up). That meant a single missed invocation on
// the one exact calendar day a task's milestone landed on lost that
// reminder forever — once "today" moves past the due date, "due_date =
// today" can never be true again for that task. The "due today" check
// below is now "due today OR EARLIER, and still open, and never
// notified" — so a task that slipped through on its actual due day still
// gets its "due" email the next time this runs, just later than
// intended, instead of never. The day-before heads-up is deliberately
// LEFT as an exact match (a "due tomorrow" nudge doesn't make sense to
// send after the fact) — the due-day catch-up is the real safety net.
// This also makes it safe to invoke this route more than once a day (e.g.
// an external scheduler running every few hours as extra insurance):
// once a task is marked notified, every later run skips it.
//
// Recipients are whoever is assigned to the task (task_item_assignees) —
// per Chad, not a single admin summary. A task with no assignees is simply
// skipped (nobody to email), but still gets marked as notified so it isn't
// checked again tomorrow.

function pacificDateString(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  // en-CA gives YYYY-MM-DD directly, in the given timezone.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
}

function formatDueDate(dateStr: string): string {
  // dateStr is a plain "YYYY-MM-DD" (no time) — parse as local calendar
  // date, not UTC, so it doesn't shift a day depending on server timezone.
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

interface TaskRow {
  id: string;
  title: string;
  due_date: string;
  task_item_assignees: { profiles: { email: string; full_name: string | null } | null }[];
}

async function notifyBatch(
  supabase: ReturnType<typeof createAdminClient>,
  dueDate: string,
  milestone: "day_before" | "due_day",
) {
  const notifiedColumn = milestone === "day_before" ? "notified_day_before_at" : "notified_due_day_at";
  const whenPhrase = milestone === "day_before" ? "due tomorrow" : "due today";

  let query = supabase
    .from("task_items")
    .select("id, title, due_date, task_item_assignees(profiles(email, full_name))")
    .eq("status", "open")
    .is(notifiedColumn, null);

  // "day_before" stays an exact match — a "due tomorrow" heads-up sent
  // after the fact doesn't make sense. "due_day" is a catch-up match (due
  // today OR earlier) so a task whose exact due-day run got missed still
  // gets emailed, once, the next time this route runs — see the file-level
  // comment above for why that matters.
  query = milestone === "day_before" ? query.eq("due_date", dueDate) : query.lte("due_date", dueDate);

  const { data: tasks, error } = await query.returns<TaskRow[]>();

  if (error) {
    return { milestone, error: error.message, sent: 0 };
  }

  let sent = 0;
  for (const task of tasks ?? []) {
    const recipients = (task.task_item_assignees ?? [])
      .map((a) => a.profiles)
      .filter((p): p is { email: string; full_name: string | null } => Boolean(p?.email));

    for (const person of recipients) {
      const firstName = person.full_name?.trim().split(/\s+/)[0] || "there";
      const paragraphs = [
        `Hi ${firstName},`,
        `This is a reminder that "${task.title}" is ${whenPhrase} (${formatDueDate(task.due_date)}).`,
        `Open Tasks in FCB Data to view or update it.`,
        `This is an automated message from a mailbox that isn't monitored — please don't reply to this email.`,
      ];
      try {
        await sendMail({
          to: person.email,
          subject: `Task ${whenPhrase}: ${task.title}`,
          text: paragraphs.join("\n\n"),
          // A real HTML body (not just the text reused as-is) so each
          // paragraph actually breaks onto its own line AND Gmail still
          // appends its own HTML signature — logos, bold text, the link —
          // underneath it. Sending text-only suppresses that signature down
          // to plain text, which is what stripped the logos out last time.
          html: paragraphs.map((p) => `<p>${p}</p>`).join(""),
        });
        sent += 1;
      } catch (sendErr) {
        // One bad address shouldn't block the rest of this batch — the
        // task is still marked notified below so it doesn't retry forever
        // against a broken address. It used to fail here with NO trace at
        // all; now at least a server-side log line exists (visible in
        // Vercel's Logs tab for as long as that plan retains logs) instead
        // of a silent, permanent, invisible non-delivery.
        console.error(
          `[task-reminders] Failed to send "${whenPhrase}" reminder for task ${task.id} to ${person.email}:`,
          sendErr,
        );
      }
    }

    await supabase.from("task_items").update({ [notifiedColumn]: new Date().toISOString() }).eq("id", task.id);
  }

  return { milestone, sent, tasks: tasks?.length ?? 0 };
}

export async function GET(req: NextRequest) {
  // Two ways in: the external scheduler (see the file-level comment above —
  // no longer Vercel's own Cron) sends the CRON_SECRET header on every
  // scheduled invocation, OR a signed-in admin can hit this URL directly
  // from their own browser (e.g. to test it on demand) — checked via their
  // normal login cookie, no secret needed. Anyone else gets turned away.
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const hasValidSecret = Boolean(cronSecret) && auth === `Bearer ${cronSecret}`;

  if (!hasValidSecret) {
    const userSupabase = await createClient();
    const {
      data: { user },
    } = await userSupabase.auth.getUser();
    let isAdmin = false;
    if (user) {
      const { data: profile } = await userSupabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      isAdmin = profile?.role === "admin";
    }
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const today = pacificDateString(0);
  const tomorrow = pacificDateString(1);

  const results = await Promise.all([
    notifyBatch(supabase, tomorrow, "day_before"),
    notifyBatch(supabase, today, "due_day"),
  ]);

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}
