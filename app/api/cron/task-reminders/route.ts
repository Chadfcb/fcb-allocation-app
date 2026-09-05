import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/sendMail";

// Task due-date email reminders (2026-09-05, per Chad: "we need the push
// notification to happen the day before it is due, and the day it is due
// on, they need to happen at 8am pst"). Run once a day by Vercel Cron (see
// vercel.json) — this is the only invocation frequency Vercel's free plan
// allows, so a single daily run checks BOTH milestones ("due tomorrow" and
// "due today") rather than needing two separate schedules.
//
// Timing note: Vercel's free plan can't guarantee an exact minute (it can
// land up to ~an hour after the scheduled time), and a fixed UTC cron time
// doesn't shift itself for Daylight Saving. vercel.json is set to land
// around 8am Pacific during PST (winter); it'll effectively run around 9am
// during PDT (summer) unless that's adjusted twice a year, or the app is
// moved to Vercel's paid plan for exact per-minute scheduling.
//
// Each task is only ever emailed once per milestone — task_items.
// notified_day_before_at / notified_due_day_at record that it's been sent,
// checked before sending and set right after (sql/task_due_reminders.sql).
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

  const { data: tasks, error } = await supabase
    .from("task_items")
    .select("id, title, due_date, task_item_assignees(profiles(email, full_name))")
    .eq("status", "open")
    .eq("due_date", dueDate)
    .is(notifiedColumn, null)
    .returns<TaskRow[]>();

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
      try {
        await sendMail({
          to: person.email,
          subject: `Task ${whenPhrase}: ${task.title}`,
          text: `Hi ${firstName},\n\nThis is a reminder that "${task.title}" is ${whenPhrase} (${formatDueDate(task.due_date)}).\n\nOpen Tasks in FCB Data to view or update it.\n\n— FCB Data\n\nThis is an automated message from a mailbox that isn't monitored — please don't reply to this email.`,
        });
        sent += 1;
      } catch {
        // One bad address shouldn't block the rest of this batch — it'll
        // just show up as "0 sent" for that task and can be investigated
        // separately; the task is still marked notified below so it
        // doesn't retry forever against a broken address.
      }
    }

    await supabase.from("task_items").update({ [notifiedColumn]: new Date().toISOString() }).eq("id", task.id);
  }

  return { milestone, sent, tasks: tasks?.length ?? 0 };
}

export async function GET(req: NextRequest) {
  // Two ways in: Vercel sends the CRON_SECRET header automatically on its
  // own scheduled invocations, OR a signed-in admin can hit this URL
  // directly from their own browser (e.g. to test it on demand, rather than
  // waiting for the daily schedule) — checked via their normal login
  // cookie, no secret needed. Anyone else gets turned away.
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
