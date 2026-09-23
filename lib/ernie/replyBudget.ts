// Time budget + prompt-cache helpers shared by Ernie's chat routes
// (app/api/ernie/chat/route.ts, app/api/ernie/project-chat/route.ts).
// Added 2026-09-23 alongside Ernie's own browser (lib/ernie/browser.ts).

// Both routes run with maxDuration = 300 (Vercel's 5-minute Hobby limit
// with Fluid compute). After this long, Ernie gets no more tool steps and
// his next round is a forced plain-text answer — leaving room for that
// final answer (and saving it) before Vercel's hard cutoff, so a long
// browsing session can never lose the whole reply.
export const REPLY_WRAP_UP_AFTER_MS = 210_000;

export function isReplyOutOfTime(replyStartedAt: number): boolean {
  return Date.now() - replyStartedAt > REPLY_WRAP_UP_AFTER_MS;
}

const CACHEABLE_BLOCK_TYPES = new Set(["text", "image", "document", "tool_result"]);

// Returns a copy of the message list with ONE prompt-cache breakpoint on the
// newest message's last cacheable block. Called fresh on every round, and
// never mutates the original list, so breakpoints don't pile up past
// Anthropic's limit of 4 (system prompt + tools + this = 3). Everything up
// to and including that block is then billed at the cached rate on the next
// round of the same reply.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic message content shape varies (string vs. content blocks)
export function withHistoryCacheBreakpoint(messages: any[]): any[] {
  if (!messages.length) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  const content =
    typeof last?.content === "string"
      ? last.content
        ? [{ type: "text", text: last.content }]
        : []
      : Array.isArray(last?.content)
        ? [...last.content]
        : [];
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (block && CACHEABLE_BLOCK_TYPES.has(block.type) && !(block.type === "text" && !block.text)) {
      content[i] = { ...block, cache_control: { type: "ephemeral" } };
      const out = [...messages];
      out[lastIdx] = { ...last, content };
      return out;
    }
  }
  return messages;
}

// Adds a plain note to the newest user turn telling Ernie time's up, so the
// forced final answer reads as a proper wrap-up ("here's what I found, and
// what I didn't get to") rather than as if he'd finished.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export function addWrapUpNote(messages: any[]): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return;
  const note = {
    type: "text",
    text: "(System note: this reply is out of time. Don't call any more tools — answer now with what you've found so far, and briefly say what you didn't get to, if anything.)",
  };
  if (typeof last.content === "string") {
    last.content = [{ type: "text", text: last.content }, note];
  } else if (Array.isArray(last.content)) {
    if (!last.content.some((b: { text?: string }) => b?.text === note.text)) last.content.push(note);
  }
}

// ---------------------------------------------------------------------
// Long-running server tools (added 2026-09-23 — fixes Shanelle's
// "`code_execution` tool use ... was found without a corresponding
// `code_execution_tool_result` block" crash when asking for a PDF).
//
// Anthropic runs web_search / web_fetch / code_execution on its own side.
// When one runs long (building a PDF in the sandbox is the usual case), the
// API can stop mid-job with stop_reason "pause_turn": the reply contains the
// server tool call but not its result yet, and the caller is expected to
// send that assistant content back UNCHANGED so Anthropic can resume it. The
// chat routes never handled pause_turn — they treated it as an empty round
// and added a "try again" user message after the half-finished tool call,
// which Anthropic rejects outright with that 400 error.
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape
export function danglingServerToolUseIds(content: any[]): string[] {
  const used = new Set<string>();
  const answered = new Set<string>();
  for (const b of content ?? []) {
    if (b?.type === "server_tool_use" && typeof b.id === "string") used.add(b.id);
    if (typeof b?.type === "string" && b.type.endsWith("_tool_result") && typeof b.tool_use_id === "string") {
      answered.add(b.tool_use_id);
    }
  }
  return [...used].filter((id) => !answered.has(id));
}

// Removes any server tool call that never got its result (e.g. a reply cut
// off by max_tokens mid-sandbox-job), so the content can safely go back into
// the conversation without Anthropic rejecting the whole request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape
export function withoutDanglingServerToolUse(content: any[]): any[] {
  const dangling = new Set(danglingServerToolUseIds(content));
  if (!dangling.size) return content;
  return (content ?? []).filter((b) => !(b?.type === "server_tool_use" && dangling.has(b.id)));
}
