import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/sendMail";

// Feedback/ticket button (2026-09-14, per Chad): lets anyone signed into
// the app report a bug or suggest an improvement from wherever they are.
// Saves a row to feedback_tickets (see sql/feedback_tickets.sql) and emails
// Chad directly via the same sendMail() helper the task reminders use —
// no separate email service, reuses ernie@fullcirclebrewing.com.

const FEEDBACK_RECIPIENT = "chad@fullcirclebrewing.com";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const category = body?.category;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const pagePath = typeof body?.pagePath === "string" ? body.pagePath : "(unknown page)";

  if (category !== "bug" && category !== "suggestion") {
    return NextResponse.json({ error: "category must be 'bug' or 'suggestion'." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Please enter a description." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const reporterEmail = profile?.email ?? user.email ?? null;
  const reporterName = profile?.full_name ?? null;

  const { error: insertError } = await supabase.from("feedback_tickets").insert({
    page_path: pagePath,
    category,
    message,
    reporter_id: user.id,
    reporter_email: reporterEmail,
    reporter_name: reporterName,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const categoryLabel = category === "bug" ? "Bug report" : "Suggestion";
  const from = reporterName ? `${reporterName} (${reporterEmail})` : reporterEmail ?? "unknown user";

  try {
    await sendMail({
      to: FEEDBACK_RECIPIENT,
      subject: `[FCB Data] ${categoryLabel}: ${pagePath}`,
      text: [
        `${categoryLabel} submitted from ${pagePath}`,
        `From: ${from}`,
        "",
        message,
      ].join("\n"),
      html: [
        `<p><strong>${categoryLabel}</strong> submitted from <code>${pagePath}</code></p>`,
        `<p>From: ${from}</p>`,
        `<p>${message.replace(/\n/g, "<br>")}</p>`,
      ].join(""),
    });
  } catch (mailErr) {
    // The ticket is already saved even if the email fails -- don't lose the
    // report over a mail hiccup, just log it so it's not silent.
    console.error("[feedback] Ticket saved but email failed to send:", mailErr);
  }

  return NextResponse.json({ ok: true });
}
