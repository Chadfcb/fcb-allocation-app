import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getErnieTools, buildErnieSystemPrompt, runErnieTool } from "@/lib/ernie/tools";
import { hasSection, getUserSections, ERNIE_SECTION, type AnySectionKey } from "@/lib/permissions";
import type { Role } from "@/lib/types/db";

// Ernie in Slack (2026-09-14, per Chad; extended same day to add real data
// access + "stay in the conversation" behavior).
//
// Behavior:
//   - Reply when @mentioned. After that, keep replying to plain messages in
//     that same channel -- no @mention needed -- until the channel's gone
//     quiet for ACTIVE_WINDOW_MS, then go back to mention-only. This is
//     tracked in ernie_slack_active_channels (sql/ernie_slack_active_channels.sql),
//     the only state this route keeps.
//   - Data access: the Slack user who triggered a reply is matched to a
//     real FCB app account by email (Slack has no idea who's typing
//     otherwise -- see resolveAppUser below), and Ernie gets exactly the
//     data tools that person's app account would have, via the same
//     getErnieTools()/hasSection() gating the main app chat uses. No match
//     (or no Ernie access granted) -> plain chat, no data tools. Web
//     search/fetch are always available regardless of who's asking.
//   - A deliberately-curated subset of Ernie's tools, not all of them --
//     see SLACK_ALLOWED_TOOL_NAMES below for why.
//
// Flow:
//   1. Verify the request actually came from Slack (HMAC over the raw body
//      using SLACK_SIGNING_SECRET), and that it's fresh (anti-replay).
//   2. Handle Slack's one-time url_verification handshake.
//   3. Handle "message" events (covers @mentions too -- see the note where
//      app_mention used to be handled separately, just below the event
//      dedupe): ignore anything from a bot (loop guard) or a non-plain
//      message subtype, decide whether to respond, ask Ernie, post back.
//
// Required env vars (already set in Vercel): SLACK_SIGNING_SECRET,
// SLACK_BOT_TOKEN, ANTHROPIC_API_KEY, plus the same NEXT_PUBLIC_SUPABASE_URL
// / SUPABASE_SERVICE_ROLE_KEY the rest of the app already has.

export const maxDuration = 60;

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 5;

// How long (ms) a channel stays "active" -- Ernie replies to plain
// messages, no @mention needed -- after its last activity, before going
// back to mention-only. Chad's call, 2026-09-14: "until it's quiet for a
// while," not forever and not a fixed end-of-day cutoff.
const ACTIVE_WINDOW_MS = 20 * 60 * 1000; // 20 minutes

// Anthropic's own hosted tools -- resolved server-side within the same API
// response, no extra handling needed here beyond including them. Mirrors
// app/api/ernie/chat/route.ts's WEB_SEARCH_TOOL / WEB_FETCH_TOOL exactly.
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
const WEB_FETCH_TOOL = {
  type: "web_fetch_20260318",
  name: "web_fetch",
  max_uses: 8,
  citations: { enabled: true },
  max_content_tokens: 50000,
};

// The subset of Ernie's normal data tools (lib/ernie/tools.ts) that are
// safe to offer here. Every one of these is gated purely by role/section at
// the CODE level (getErnieTools()/canUseTool() below) against a plain
// global table -- not by row-level security scoped to a live signed-in
// session, which Slack has no equivalent of. Two of Ernie's normal tools
// work the opposite way -- their only real protection is Postgres RLS
// running as the actual signed-in user (run_read_only_query: a Basic
// user's query against an admin-only table comes back empty only because
// RLS enforces that for a real session; search_past_conversations: RLS is
// what keeps one person from reading another's chat history) -- and this
// route talks to the database with the SERVICE ROLE key, which bypasses
// RLS entirely. Offering either of those two tools here would quietly hand
// every Slack user admin-level access regardless of their real role, so
// they're deliberately left out. Every write tool (calendar add/update/
// delete, task creation, spreadsheet editing, file uploads, person notes)
// is left out too -- this is read-only, chat-and-look-things-up, for now.
const SLACK_ALLOWED_TOOL_NAMES = new Set([
  "list_weeks",
  "get_inventory_and_allocations",
  "get_distributor_inventory",
  "get_build_orders",
  "get_distributors",
  "get_purchase_orders",
  "get_cashflow_dashboard",
  "get_events",
  "get_pricing_data",
  "get_pos_label_files",
  "get_users",
  "list_social_media_calendar_events",
  "list_chain_calendar_events",
]);

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

async function slackApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function postToSlack(channel: string, text: string) {
  const data = await slackApi("chat.postMessage", { channel, text });
  if (!data?.ok) console.error("[slack/events] chat.postMessage failed:", data);
}

// Ernie's own Slack identity -- fetched once (auth.test) and reused for the
// life of this warm serverless instance. user_id is what shows up in a
// message's "user" field if Ernie ever posted as a real user (it doesn't
// here); bot_id is what actually shows up on Ernie's own chat.postMessage
// output, and is how fetchChannelHistory tells "Ernie said this" apart from
// "a person said this."
let cachedBotIdentity: { userId: string; botId: string } | null = null;
async function getBotIdentity() {
  if (cachedBotIdentity) return cachedBotIdentity;
  const data = await slackApi("auth.test", {});
  if (!data?.ok) throw new Error(`Slack auth.test failed: ${JSON.stringify(data)}`);
  cachedBotIdentity = { userId: data.user_id, botId: data.bot_id };
  return cachedBotIdentity;
}

const slackDisplayNameCache = new Map<string, string>();
async function getSlackDisplayName(userId: string): Promise<string> {
  if (slackDisplayNameCache.has(userId)) return slackDisplayNameCache.get(userId)!;
  const data = await slackApi("users.info", { user: userId });
  const name: string =
    data?.user?.profile?.display_name || data?.user?.profile?.real_name || data?.user?.real_name || userId;
  slackDisplayNameCache.set(userId, name);
  return name;
}

async function getSlackUserEmail(userId: string): Promise<string | null> {
  const data = await slackApi("users.info", { user: userId });
  if (!data?.ok) {
    console.error("[slack/events] users.info failed while resolving email:", JSON.stringify(data));
    return null;
  }
  const email = data?.user?.profile?.email ?? null;
  if (!email) {
    console.error("[slack/events] users.info succeeded but returned no email for user:", userId);
  }
  return email;
}

interface AppUser {
  userId: string;
  role: Role | undefined;
  isSuperAdmin: boolean;
  sections: AnySectionKey[];
  personNotes: string | null;
}

// Maps the Slack user who triggered this to a real FCB app account by
// email -- Slack tells us a Slack user id and profile, never an app login,
// so email is the bridge. No match (different email, or no FCB account at
// all) -> null, meaning Ernie still chats but gets no data tools for that
// person. Uses the service-role client since there's no browser session
// here to run this as.
async function resolveAppUser(
  supabase: ReturnType<typeof createAdminClient>,
  slackUserId: string,
): Promise<AppUser | null> {
  const email = await getSlackUserEmail(slackUserId);
  if (!email) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, is_super_admin")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) {
    console.error(`[slack/events] No FCB profiles row matched Slack email: ${email}`);
    return null;
  }

  const isSuperAdmin = profile.is_super_admin === true;
  const sections = isSuperAdmin ? [] : await getUserSections(supabase, profile.id);

  const { data: notesRow } = await supabase
    .from("ernie_user_notes")
    .select("notes")
    .eq("user_id", profile.id)
    .maybeSingle();

  return {
    userId: profile.id,
    role: profile.role as Role | undefined,
    isSuperAdmin,
    sections,
    personNotes: notesRow?.notes ?? null,
  };
}

async function isChannelActive(supabase: ReturnType<typeof createAdminClient>, channelId: string): Promise<boolean> {
  const { data } = await supabase
    .from("ernie_slack_active_channels")
    .select("last_activity_at")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!data) return false;
  return Date.now() - new Date(data.last_activity_at).getTime() < ACTIVE_WINDOW_MS;
}

async function markChannelActive(supabase: ReturnType<typeof createAdminClient>, channelId: string) {
  await supabase
    .from("ernie_slack_active_channels")
    .upsert({ channel_id: channelId, last_activity_at: new Date().toISOString() }, { onConflict: "channel_id" });
}

interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

// Slack IS the conversation history here (no ernie_conversations row backs
// a Slack thread) -- pull the last handful of messages in the channel and
// turn them into a normal back-and-forth transcript so Ernie has real
// context instead of answering each message in isolation. Each user turn
// is labeled with who said it, since a channel can have more than one
// person talking to Ernie.
async function fetchChannelHistory(channel: string, botId: string): Promise<HistoryTurn[]> {
  const data = await slackApi("conversations.history", { channel, limit: 20 });
  if (!data?.ok) {
    console.error("[slack/events] conversations.history failed:", data);
    return [];
  }

  const raw = [...(data.messages ?? [])].reverse(); // oldest first
  const turns: HistoryTurn[] = [];

  for (const m of raw) {
    // Skip joins/leaves/edits/etc -- anything but a plain message or
    // Ernie's own bot-posted reply.
    if (m.subtype && m.subtype !== "bot_message") continue;
    const rawText = typeof m.text === "string" ? m.text.replace(/<@[^>]+>\s*/g, "").trim() : "";
    if (!rawText) continue;

    const isErnie = Boolean(m.bot_id) && m.bot_id === botId;
    if (isErnie) {
      turns.push({ role: "assistant", text: rawText });
    } else {
      const name = await getSlackDisplayName(m.user ?? "someone");
      turns.push({ role: "user", text: `${name}: ${rawText}` });
    }
  }

  // Claude's Messages API requires strictly alternating user/assistant
  // turns -- collapse consecutive same-role messages (several people
  // talking in a row before Ernie replies) into one turn instead.
  const collapsed: HistoryTurn[] = [];
  for (const turn of turns) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === turn.role) {
      last.text += `\n${turn.text}`;
    } else {
      collapsed.push({ ...turn });
    }
  }

  // Must end on a user turn to be a valid prompt for Claude.
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].role !== "user") {
    collapsed.pop();
  }

  return collapsed;
}

async function askErnie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic message content shape varies (string vs. tool blocks) across the tool-use loop
  history: any[],
  appUser: AppUser | null,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const slackNote =
    " You're replying inside a Slack channel where more than one person may be talking -- each line of the conversation history is labeled with who said it. Keep replies short and Slack-appropriate: plain text, no markdown headers, and never mention threading (Ernie always posts as a new message here, never a threaded reply).";

  let systemPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool definitions mix Ernie's own shape with Anthropic's hosted-tool shape
  let tools: any[] = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];

  if (appUser && hasSection(appUser.role, appUser.sections, ERNIE_SECTION, appUser.isSuperAdmin)) {
    systemPrompt =
      buildErnieSystemPrompt(appUser.role, appUser.sections, appUser.isSuperAdmin, appUser.personNotes) + slackNote;
    const allowedDataTools = getErnieTools(appUser.role, appUser.sections, appUser.isSuperAdmin).filter((t) =>
      SLACK_ALLOWED_TOOL_NAMES.has(t.name),
    );
    tools = [...allowedDataTools, WEB_SEARCH_TOOL, WEB_FETCH_TOOL];
  } else {
    systemPrompt =
      "You are Ernie, Full Circle Brewing's AI assistant. This person isn't recognized as an FCB app user (or doesn't have Ernie access granted on their account), so you have no access to Full Circle's own data -- just have a normal, friendly conversation, and use web search/fetch if it's genuinely useful to answer something." +
      slackNote;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  const messages: any[] = [...history];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        // Basic (5-minute) prompt caching, same as the main Ernie chat
        // backend -- the system prompt + tool list are identical across
        // every round of this loop and across separate Slack messages for
        // the same person.
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: [...tools.slice(0, -1), { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } }],
        ...(isLastRound ? { tool_choice: { type: "none" } } : {}),
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[slack/events] Anthropic API error:", res.status, detail);
      return "Sorry, I ran into an error trying to respond to that.";
    }

    const data = await res.json();
    const content = data.content ?? [];

    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      const toolResults: any[] = [];
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        let result: unknown;
        try {
          result = await runErnieTool(
            supabase,
            block.name,
            block.input ?? {},
            appUser?.role,
            appUser?.sections ?? [],
            undefined,
            appUser?.isSuperAdmin ?? false,
            appUser?.userId,
            crypto.randomUUID(),
          );
        } catch (toolErr) {
          result = { error: toolErr instanceof Error ? toolErr.message : "Tool lookup failed" };
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const finalText = content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      .filter((b: any) => b.type === "text")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return finalText || "Sorry, I didn't have anything to say to that.";
  }

  return "Sorry, I wasn't able to put together an answer for that.";
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
  // (with the same event_id) if it doesn't get one in time. Asking Ernie
  // for a reply (plus any tool calls) can take longer than that, so a
  // retry is expected/normal here -- this dedupe is what keeps a retry
  // from producing a duplicate Slack reply.
  const eventId: string | undefined = payload.event_id;
  if (eventId) {
    if (seenEventIds.has(eventId)) {
      return NextResponse.json({ ok: true });
    }
    seenEventIds.add(eventId);
    if (seenEventIds.size > 1000) {
      const first = seenEventIds.values().next().value;
      if (first) seenEventIds.delete(first);
    }
  }

  const event = payload.event;

  // Only plain "message" events matter here -- app_mention fires
  // ALONGSIDE a "message" event for the very same @mention, and
  // message.channels/message.groups (this app's subscribed bot events)
  // already cover every message in a channel Ernie's a member of, mention
  // or not. Handling app_mention too would just mean replying twice to the
  // same @mention. Ignore anything from a bot (loop guard, including
  // Ernie's own posts) and any non-plain subtype (edits, joins, etc).
  if (event?.type === "message" && !event.subtype && !event.bot_id && typeof event.text === "string") {
    try {
      const { userId: botUserId, botId } = await getBotIdentity();
      const isMentioned = event.text.includes(`<@${botUserId}>`);
      const supabase = createAdminClient();

      const active = isMentioned || (await isChannelActive(supabase, event.channel));
      if (!active) {
        return NextResponse.json({ ok: true });
      }

      let history = await fetchChannelHistory(event.channel, botId);
      if (history.length === 0) {
        // Fallback if history came back empty for some reason -- still
        // respond to at least the message that triggered this.
        const name = event.user ? await getSlackDisplayName(event.user) : "someone";
        const strippedText = event.text.replace(/<@[^>]+>\s*/g, "").trim();
        history = [{ role: "user", text: `${name}: ${strippedText || "Hello!"}` }];
      }

      const appUser = event.user ? await resolveAppUser(supabase, event.user) : null;
      const anthropicMessages = history.map((h) => ({ role: h.role, content: h.text }));
      const reply = await askErnie(anthropicMessages, appUser, supabase);

      // Chad's preference (2026-09-14): always post as a fresh top-level
      // message in the channel, never as a threaded reply.
      await postToSlack(event.channel, reply);
      await markChannelActive(supabase, event.channel);
    } catch (err) {
      console.error("[slack/events] Error handling message:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
