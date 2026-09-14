import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// Ernie in Slack -- minimal first version (2026-09-14, per Chad).
//
// Scope for this version, intentionally: reply only when @mentioned, plain
// conversational Claude response, no tools/data access, no memory across
// messages. Chad is testing this in the #Ernie_testing channel and will
// decide what capabilities to add from here.
//
// Flow:
//   1. Verify the request actually came from Slack (HMAC over the raw body
//      using SLACK_SIGNING_SECRET), and that it's fresh (anti-replay).
//   2. Handle Slack's one-time url_verification handshake.
//   3. Handle app_mention events: ignore anything from a bot (loop guard),
//      ask Claude for a plain reply, post it back via chat.postMessage.
//
// Required env vars (already set in Vercel): SLACK_SIGNING_SECRET,
// SLACK_BOT_TOKEN, ANTHROPIC_API_KEY.

export const maxDuration = 60;

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

// Slack event_ids we've already handled -- Slack retries delivery on slow
// responses, and without this we'd post a duplicate reply. In-memory is
// fine for a single serverless instance's lifetime; not durable across
// cold starts, but cheap and good enough for this v1.
const seenEventIds = new Set<string>();

function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes to guard against replay attacks.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", SLACK_SIGNING_SECRET);
  hmac.update(base);
  const computed = `v0=${hmac.digest("hex")}`;

  // Constant-time compare.
  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function askClaude(userText: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system:
        "You are Ernie, Full Circle Brewing's AI assistant, chatting in Slack. " +
        "This is an early test version: you don't yet have access to any of " +
        "Full Circle's data or tools -- just have a normal, friendly, concise " +
        "conversation. Keep replies short and Slack-appropriate (plain text, " +
        "not markdown headers).",
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[slack/events] Anthropic API error:", res.status, errText);
    return "Sorry, I ran into an error trying to respond to that.";
  }

  const data = await res.json();
  const textBlock = data?.content?.find((b: { type: string }) => b.type === "text");
  return textBlock?.text?.trim() || "Sorry, I didn't have anything to say to that.";
}

async function postToSlack(channel: string, text: string, thread_ts?: string) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text, ...(thread_ts ? { thread_ts } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.ok) {
    console.error("[slack/events] chat.postMessage failed:", data);
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  // One-time handshake Slack does when you first save the Request URL.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  // Slack expects an ack within 3 seconds and will retry the same event
  // (with the same event_id) if it doesn't get one in time. Asking Claude
  // for a reply can take longer than that, so a retry is expected/normal
  // here -- the event_id dedupe above/below is what keeps that from
  // producing a duplicate Slack reply.
  const eventId: string | undefined = payload.event_id;
  if (eventId) {
    if (seenEventIds.has(eventId)) {
      return NextResponse.json({ ok: true });
    }
    seenEventIds.add(eventId);
    // Keep the set from growing unbounded.
    if (seenEventIds.size > 1000) {
      const first = seenEventIds.values().next().value;
      if (first) seenEventIds.delete(first);
    }
  }

  const event = payload.event;

  // Ignore anything not a plain app_mention, and anything from a bot
  // (including ourselves) to avoid reply loops.
  if (event?.type === "app_mention" && !event.bot_id) {
    // Strip the leading "<@BOTID>" mention off the message text.
    const text = (event.text as string).replace(/<@[^>]+>\s*/, "").trim();

    try {
      const reply = await askClaude(text || "Hello!");
      // Chad's preference (2026-09-14): always post as a fresh top-level
      // message in the channel, never as a threaded reply -- even when
      // the @mention itself came from inside a thread. No thread_ts is
      // passed here on purpose.
      await postToSlack(event.channel, reply);
    } catch (err) {
      console.error("[slack/events] Error handling app_mention:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
