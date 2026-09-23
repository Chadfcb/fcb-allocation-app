import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getErnieTools, buildErnieSystemPrompt, runErnieTool } from "@/lib/ernie/tools";
import { hasSection, getUserSections, ERNIE_SECTION, type AnySectionKey } from "@/lib/permissions";
import type { Role } from "@/lib/types/db";

// Ernie in Slack (2026-09-14, per Chad; extended same day to add real data
// access; reverted 2026-09-17 back to mention-only; extended again the same
// day to let Ernie create AND edit tasks and calendar events from Slack,
// then again the same day to let Ernie bundle several related actions into
// one proposal via propose_actions -- see below).
//
// Behavior:
//   - Reply ONLY when @mentioned, every time -- no "stay active" window,
//     no replying to a plain follow-up message with no @mention. This was
//     briefly changed, the same day it was built, to keep replying to plain
//     messages for a while after a mention -- but that switched the
//     triggering event from Slack's app_mention to a plain "message" event,
//     and a plain "message" event is never delivered at all for a DM or
//     group DM unless the app has separately been granted im/mpim history
//     permission, which it never was. That silently broke Ernie in exactly
//     the group DM Chad and Eddie actually use him in, while leaving him
//     working fine in ordinary channels the whole time. Per Chad
//     (2026-09-17): revert to mention-only on the Slack side; the main
//     FCB-Data app's Ernie (app/api/ernie/chat/route.ts) is untouched --
//     this file only affects Slack.
//   - Data access: the Slack user who triggered a reply is matched to a
//     real FCB app account via a manual mapping table
//     (ernie_slack_user_map / sql_ernie_slack_user_map.sql) -- NOT by email
//     lookup through Slack's API, which turned out to return
//     "user_not_found" for real, verified users in this workspace even with
//     the right scopes granted (see resolveAppUser below for the full
//     story). Ernie gets exactly the data tools that mapped person's app
//     account would have, via the same getErnieTools()/hasSection() gating
//     the main app chat uses. No mapping row (or no Ernie access granted)
//     -> plain chat, no data tools. Web search/fetch are always available
//     regardless of who's asking.
//   - A deliberately-curated subset of Ernie's tools, not all of them --
//     see SLACK_ALLOWED_TOOL_NAMES below for why.
//
// Flow:
//   1. Verify the request actually came from Slack (HMAC over the raw body
//      using SLACK_SIGNING_SECRET), and that it's fresh (anti-replay).
//   2. Handle Slack's one-time url_verification handshake.
//   3. Handle "app_mention" events only: ignore anything from a bot (loop
//      guard), ask Ernie, post back.
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
// they're deliberately left out.
//
// Task/calendar-event creation were turned ON here 2026-09-17, per Chad
// ("ernie in slack should be able to create tasks, and add events to
// calendars, just like in the app"), then editing turned on the same day
// too ("he needs the edit ability as well"). These are still fully safe to
// expose: every one of create_task/update_task/add_*_calendar_event/
// update_*_calendar_event never writes anything by itself -- calling one
// without confirmed only validates the input and stores a preview (see the
// big propose-then-confirm comment above add_social_media_calendar_event's
// definition in lib/ernie/tools.ts); the actual write only happens once
// confirm_pending_action runs, and that's gated by the SAME role/section
// check all over again at that point, not just when the tool was first
// offered. Every DELETE tool (delete_task's nonexistent -- tasks can only
// be marked resolved -- and delete_*_calendar_event) is still deliberately
// left out, since removing something wasn't asked for. get_task_categories
// is a new small read-only tool (added 2026-09-17, in lib/ernie/tools.ts)
// that lets Ernie look up a task's required subcategory_id without needing
// run_read_only_query, which stays excluded here for the RLS-bypass reason
// above. create_task_subcategory (added later the same day, per Chad:
// "ernie cant create sub category tasks, fix please") lets Ernie propose a
// brand-new Subcategory under an existing Category -- same propose-then-
// confirm safety as every write tool above, so it's safe to turn on here too.
// propose_actions (added later still the same day, after Ernie was seen
// narrating a "create a subcategory, then file the task under it" plan in
// Slack without ever actually calling a tool for it) lets Ernie bundle
// several of the write tools above into ONE proposal, confirmed together --
// still nothing happens until confirm_pending_action runs, so it's safe to
// expose the same way.
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
  "get_tasks",
  "get_task_categories",
  "create_task",
  "update_task",
  "create_task_subcategory",
  "add_social_media_calendar_event",
  "update_social_media_calendar_event",
  "add_events_calendar_event",
  "update_events_calendar_event",
  "add_chain_calendar_event",
  "update_chain_calendar_event",
  "propose_actions",
  "confirm_pending_action",
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
// Note: Slack's users.info has proven unreliable in this workspace (returns
// user_not_found for real, verified users even with the right scopes --
// see resolveAppUser's comment above), so this quietly falls back to the
// raw Slack user id as the "name" when that happens. Cosmetic only --
// history labeling may show an id instead of a real name; doesn't affect
// data access or Ernie's ability to reply.
async function getSlackDisplayName(userId: string): Promise<string> {
  if (slackDisplayNameCache.has(userId)) return slackDisplayNameCache.get(userId)!;
  const data = await slackApi("users.info", { user: userId });
  const name: string =
    data?.user?.profile?.display_name || data?.user?.profile?.real_name || data?.user?.real_name || userId;
  slackDisplayNameCache.set(userId, name);
  return name;
}

interface AppUser {
  userId: string;
  role: Role | undefined;
  isSuperAdmin: boolean;
  sections: AnySectionKey[];
  personNotes: string | null;
}

// Maps the Slack user who triggered this to a real FCB app account via a
// manual mapping table (ernie_slack_user_map / sql_ernie_slack_user_map.sql)
// instead of Slack's users.info email lookup -- that lookup turned out to
// return "user_not_found" for real, verified users in this workspace even
// with the right scopes granted (a Slack platform-side quirk, not something
// fixable in our code), so this sidesteps it entirely. No mapping row for
// this Slack user -> null, meaning Ernie still chats but gets no data tools
// for that person. Uses the service-role client since there's no browser
// session here to run this as.
async function resolveAppUser(
  supabase: ReturnType<typeof createAdminClient>,
  slackUserId: string,
): Promise<AppUser | null> {
  const { data: mapping } = await supabase
    .from("ernie_slack_user_map")
    .select("app_user_id")
    .eq("slack_user_id", slackUserId)
    .maybeSingle();
  if (!mapping) {
    console.error(`[slack/events] No ernie_slack_user_map row for Slack user id: ${slackUserId}`);
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, is_super_admin")
    .eq("id", mapping.app_user_id)
    .maybeSingle();
  if (!profile) {
    console.error(`[slack/events] Mapped app_user_id has no profiles row: ${mapping.app_user_id}`);
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
    // Added 2026-09-23: the shared system prompt describes the app's code
    // sandbox, file building, image tools, and web browser -- none of which
    // exist here in Slack -- so Ernie must not offer them in Slack.
    " IMPORTANT -- in Slack you do NOT have the code sandbox, file creation (PDF, Word, spreadsheet, PowerPoint, charts), image generation/editing, or the web browser that the rest of these instructions describe; those only work in the FCB-Data app's Ernie page. If someone in Slack asks you to make a file or image, tell them plainly you can't do that here in Slack and to ask you on the Ernie page in FCB-Data, where you can build it for them." +
    " You're replying inside a Slack channel where more than one person may be talking -- each line of the conversation history is labeled with who said it. Keep replies short and Slack-appropriate: plain text, no markdown headers or asterisk bullets, and never mention threading (Ernie always posts as a new message here, never a threaded reply). When listing multiple items (e.g. events, orders, tasks), put each one on its own line -- a plain line break between items, not a comma-separated sentence and not markdown bullet syntax." +
    " If you propose creating or changing a task, task subcategory, or calendar event (create_task/update_task/create_task_subcategory/add_social_media_calendar_event/update_social_media_calendar_event/add_events_calendar_event/update_events_calendar_event/add_chain_calendar_event/update_chain_calendar_event), or a bundle of several of these via propose_actions, remember you only see messages where you're @-mentioned -- so after you show someone the preview (the FULL numbered list, for a bundle), explicitly tell them to @-mention you again with their approval (e.g. \"@Ernie yes, do that\") to confirm it. A plain reply with no @-mention won't reach you at all, so don't just say \"let me know\" -- say they need to tag you. When a request has more than one part (e.g. a new subcategory AND a task filed under it), you MUST actually call propose_actions to stage it -- never just describe the steps in plain text and say \"tag me to confirm,\" since nothing is actually staged until you call the tool, and a later confirmation will find nothing to confirm.";

  let systemPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool definitions mix Ernie's own shape with Anthropic's hosted-tool shape
  let tools: any[] = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];

  // One id for this entire Slack event -- i.e. this one call to askErnie,
  // covering every round of its tool-use loop below. Passed to every
  // runErnieTool() call so create_task/add_*_calendar_event's
  // propose-then-confirm machinery (see loadConfirmedPendingAction in
  // lib/ernie/tools.ts) can structurally guarantee confirm_pending_action is
  // never honored inside the SAME Slack message that proposed the action --
  // only a later message (a genuine new @mention from the user) carries a
  // different requestId. Mirrors app/api/ernie/chat/route.ts's requestId
  // exactly. Previously this was (incorrectly) generated fresh for every
  // individual tool call below, which would have let that safety check be
  // bypassed the moment task/calendar write tools were turned on here --
  // fixed as part of turning them on (2026-09-17).
  const requestId = crypto.randomUUID();

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
        // Prompt caching, same as the main Ernie chat backend -- the system
        // prompt + tool list are identical across every round of this loop
        // and across separate Slack messages for the same person. 1-hour
        // cache as of 2026-09-23 (was 5 minutes), per Chad, so a Slack
        // question after a quiet spell still hits the cache.
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
        tools: [...tools.slice(0, -1), { ...tools[tools.length - 1], cache_control: { type: "ephemeral", ttl: "1h" } }],
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
            requestId,
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

    // Guard against a real bug seen live on 2026-09-17/18: for a calendar
    // event (and previously for a bundled task+subcategory), Ernie replied
    // with fully fabricated "here's the preview... @-mention me to confirm"
    // / "okay, this is genuinely staged now" text WITHOUT ever calling the
    // propose/confirm tool that round -- i.e. stop_reason wasn't "tool_use"
    // at all, so nothing was ever written to ernie_pending_actions. The
    // system prompt already says in the strongest terms not to do this
    // (see the "CRITICAL" sentence in buildErnieSystemPrompt), but that
    // alone didn't reliably stop it, so this is a structural backstop:
    // pattern-match the reply for the telltale phrasing of a staged/
    // confirmed action, and if it fired with no actual tool call this
    // round, don't send that fabricated text to the user at all -- push a
    // blunt corrective message and give the model one more round to
    // actually call the tool instead.
    const soundsLikeFabricatedAction =
      hasAnyWriteAccessForFabricationCheck(tools) &&
      /@[- ]?mention me|tag me (again|once more)|here'?s the preview|genuinely staged|is staged now|i'?ve (added|created|staged)|it'?s (now )?staged|confirm and i'?ll add|confirm(ed)? and it('| wi)ll (go in|be added)/i.test(
        finalText,
      );
    if (soundsLikeFabricatedAction && !isLastRound) {
      messages.push({ role: "assistant", content: finalText });
      messages.push({
        role: "user",
        content:
          "SYSTEM CHECK (not from the person you're talking to): your last reply described a preview, staged action, or confirmation for a calendar/task change, but you did NOT call any tool that round -- nothing has actually been staged or written, and that reply was blocked from being sent. Do not describe a fictitious preview or repeat that claim in different words. If something needs to be proposed, call the real tool (or propose_actions) right now. If you believe something is already genuinely staged from an earlier tool call in this conversation and the person just approved it, call confirm_pending_action right now with no arguments. Take the real tool action in this round -- do not reply with text alone.",
      });
      continue;
    }

    return finalText || "Sorry, I didn't have anything to say to that.";
  }

  return "Sorry, I wasn't able to put together an answer for that.";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool list mixes Ernie's own tool shape with Anthropic's hosted-tool shape
function hasAnyWriteAccessForFabricationCheck(tools: any[]): boolean {
  return tools.some((t) => typeof t?.name === "string" && WRITE_TOOL_NAMES_FOR_FABRICATION_CHECK.has(t.name));
}

const WRITE_TOOL_NAMES_FOR_FABRICATION_CHECK = new Set([
  "create_task",
  "update_task",
  "create_task_subcategory",
  "add_social_media_calendar_event",
  "update_social_media_calendar_event",
  "add_events_calendar_event",
  "update_events_calendar_event",
  "add_chain_calendar_event",
  "update_chain_calendar_event",
  "propose_actions",
  "confirm_pending_action",
]);

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

  // Mention-only, every time (reverted 2026-09-17 -- see file header).
  // app_mention fires for an @mention anywhere Ernie's a member, including
  // a DM or group DM, without needing the im/mpim history permission a
  // plain "message" event would require. Ignore anything from a bot (loop
  // guard) and anything without real text.
  if (event?.type === "app_mention" && !event.bot_id && typeof event.text === "string") {
    try {
      const { botId } = await getBotIdentity();
      const supabase = createAdminClient();

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
    } catch (err) {
      console.error("[slack/events] Error handling message:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
