import type { createAdminClient } from "@/lib/supabase/admin";
import { ASPECTS, ernieImage, type Aspect } from "@/lib/email/ernieStudio";
import { ernieEditEmail, type EmailEditScope } from "@/lib/email/ernieEmailEdit";

// Email Studio → Ernie → Chat (added 2026-11-20, per Chad / Eddie: "can we
// have ernie chat in there, so he can work with ernie directly in that
// section"). Plan: claude/email-studio-ernie-chat-plan.md. Server-only.
//
// The chat itself runs through the normal Ernie chat (/api/ernie/chat, Claude,
// all of Ernie's app tools with the person's own access). When the request
// comes from the email designer it carries the open email, and Ernie gets the
// extra tools below:
//   edit_email          → the existing Gemini "Edit email" step on the real
//                         HTML; the result is streamed to the designer, which
//                         puts it in the email (Undo works the same as the
//                         Edit email tab).
//   look_at_email_html  → the email's real HTML, for exact layout/color questions.
//   list_library_images → pictures in the Creative Library (to use in the email).
//   make_image / change_image → the existing Creative Library image tools.
// Edits and images count toward the same monthly caps as the Edit email /
// Create / Edit picture tabs (lib/email/ernieStudio.ts).

type Admin = ReturnType<typeof createAdminClient>;

/** What the designer sends with each chat message. */
export type EmailChatContext = {
  designId: string;
  name?: string | null;
  subject?: string | null;
  preheader?: string | null;
  html: string;
  selectionHtml?: string | null;
  selectionCss?: string | null;
  selectedLabel?: string | null;
};

/** Per-reply state: the email as Ernie's edits change it during one reply. */
export type EmailChatState = {
  ctx: EmailChatContext;
  html: string;
  /** Ernie changed only part of the email this reply (the server no longer has an exact copy). */
  partEdited: boolean;
};

export type EmailChatEvent =
  | { type: "email_edit"; html: string; scope: EmailEditScope; note: string; swaps: number }
  | { type: "email_asset"; asset: Record<string, unknown> };

const MAX_OUTLINE_CHARS = 15000;
const MAX_HTML_CHARS = 80000;
const WEB_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export const EMAIL_CHAT_TOOL_NAMES = ["edit_email", "look_at_email_html", "list_library_images", "make_image", "change_image"];

/** Ernie's own image tools on the Ernie page; in the email chat the Creative Library ones are used instead. */
export const TOOLS_HIDDEN_IN_EMAIL_CHAT = ["generate_image", "edit_image", "animate_image"];

export function isEmailChatContext(v: unknown): v is EmailChatContext {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.designId === "string" && o.designId.length > 0 && typeof o.html === "string";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : "";
}

/** The email as readable text: words, [Picture: …], [Button/link: text → url]. Cheap for Ernie to read every message. */
export function emailOutline(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (whole, inner: string) => {
    const href = attr(whole, "href");
    const text = decodeEntities(inner.replace(/<img\b[^>]*>/gi, (img) => ` (picture: ${attr(img, "alt") || "no description"}) `).replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    return ` [Link/button: ${text || "(no text)"}${href ? ` → ${href}` : ""}] `;
  });
  s = s.replace(/<img\b[^>]*>/gi, (img) => {
    const src = attr(img, "src");
    const alt = attr(img, "alt");
    const file = src.split("/").pop()?.split("?")[0] ?? "";
    const swap = /ERNIE_PHOTO|swap/i.test(src) ? " — gray 'Swap this picture' box" : "";
    return `\n[Picture: ${alt || file || "no description"}${swap}]\n`;
  });
  s = s
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|td)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])\b[^>]*>/gi, "\n## ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return s.length > MAX_OUTLINE_CHARS ? `${s.slice(0, MAX_OUTLINE_CHARS)}\n…(rest of the email cut off — use look_at_email_html)` : s;
}

/** Fixed instructions for the email chat (same every message). */
export const EMAIL_CHAT_SYSTEM_PROMPT = `

## You are inside the Email Studio designer
This conversation is the Ernie chat inside FCB-Data's Email Studio, where FCB's designer (usually Eddie) builds marketing emails sent to the bars, restaurants and stores that sell our beer. Each of their messages starts with a snapshot of the email that's open right now (its name, subject line, preheader, what part is selected, and the email's text with [Picture: …] and [Link/button: …] markers). Talk with them like a helpful creative partner: ideas, wording, subject lines, feedback, and making changes when asked.

Tools only for this chat:
- edit_email — changes the email itself: part "whole" (the whole email), "selected" (only what they've clicked in the designer — only if the snapshot says something is selected), or "new_section" (adds a section below the selected part, or at the end). Write clear, complete instructions; quote exact wording when they gave it. The change appears in the designer right away and they can Undo it. Use it when they ask for a change (or say yes to one you suggested) — don't change the email just because you had an idea; suggest it first. Before rewriting the WHOLE email, check with them unless they clearly asked for that. One part-only change ("selected" / "new_section") per reply; say what you did and let them ask for the next one.
- To put a Creative Library picture into the email, pass its id in edit_email's use_picture_ids (find it with list_library_images). To rebuild a flyer/mockup picture as a real email, pass rebuild_from_picture_id.
- make_image / change_image — make a new picture or change one from the Creative Library. It's saved to the Creative Library and shows in the chat with a "Put it in the email" button. Each costs real money (about 13¢), so only when asked, one at a time unless they ask for options. No real people or other brands' logos.
- look_at_email_html — the email's actual HTML, only when you need exact colors, sizes or layout.
Your normal tools (sales, products, accounts, what's new, the price list…) still work — use them when the email needs real facts. Never invent prices, deals, dates or claims. Never aim anything at people under 21. Keep replies short; the person is designing.`;

/** The snapshot added in front of each message from the designer. */
export function emailSnapshotText(ctx: EmailChatContext): string {
  const sel = ctx.selectedLabel
    ? `Selected in the designer: ${ctx.selectedLabel}${ctx.selectionHtml ? `\nSelected part's text: ${emailOutline(ctx.selectionHtml).slice(0, 1500)}` : ""}`
    : "Nothing is selected in the designer.";
  return `[Email open in the designer right now — snapshot for Ernie]
Email name: ${ctx.name || "(untitled)"}
Subject line: ${ctx.subject || "(none yet)"}
Preheader: ${ctx.preheader || "(none yet)"}
${sel}
Email text:
${emailOutline(ctx.html) || "(the email is empty)"}
[End of snapshot — the person's message follows]`;
}

export const EMAIL_CHAT_TOOLS = [
  {
    name: "edit_email",
    description:
      "Change the email open in the designer (text, layout, buttons, colors, sections). The change is put into the designer right away and can be undone. part: whole = the whole email; selected = only the part selected in the designer; new_section = add a new section below the selected part (or at the end).",
    input_schema: {
      type: "object" as const,
      properties: {
        part: { type: "string", enum: ["whole", "selected", "new_section"] },
        instructions: { type: "string", description: "Exactly what to change, written for the email editor. Include exact wording to use." },
        use_picture_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional: Creative Library picture ids (from list_library_images / make_image) to use in the email.",
        },
        rebuild_from_picture_id: {
          type: "string",
          description: "Optional: a Creative Library picture of a flyer/mockup to rebuild as a real, editable email.",
        },
      },
      required: ["part", "instructions"],
    },
  },
  {
    name: "look_at_email_html",
    description: "Get the open email's real HTML (as it is now, including changes made earlier in this reply). Only for exact colors, sizes or layout.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_library_images",
    description: "List pictures in the Email Studio Creative Library (newest first): id, name, link. Optional search by name.",
    input_schema: {
      type: "object" as const,
      properties: { search: { type: "string", description: "Optional words in the picture's name." } },
    },
  },
  {
    name: "make_image",
    description: "Make a new picture (saved to the Creative Library, shown in the chat with a 'Put it in the email' button). About 13¢. Write a detailed description: subject, style, colors, mood; no text in the picture unless asked.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string" },
        shape: { type: "string", enum: [...ASPECTS], description: "16:9 = wide email banner (default), 1:1 square, 4:5 portrait…" },
      },
      required: ["description"],
    },
  },
  {
    name: "change_image",
    description: "Change a Creative Library picture (the original stays; the result is a new picture). About 13¢.",
    input_schema: {
      type: "object" as const,
      properties: {
        image_id: { type: "string", description: "Creative Library picture id (from list_library_images)." },
        instructions: { type: "string" },
      },
      required: ["image_id", "instructions"],
    },
  },
];

export function describeEmailChatTool(name: string): string {
  switch (name) {
    case "edit_email":
      return "Changing the email";
    case "look_at_email_html":
      return "Looking at the email's layout";
    case "list_library_images":
      return "Looking through the Creative Library";
    case "make_image":
      return "Making a picture";
    case "change_image":
      return "Changing a picture";
    default:
      return "Working";
  }
}

async function libraryPictures(admin: Admin, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await admin.from("creative_assets").select("id, name, public_url, mime_type").in("id", ids);
  if (error) throw error;
  return data ?? [];
}

/** Runs one email-chat tool. Anything the designer must act on goes out through send(). */
export async function runEmailChatTool(
  admin: Admin,
  userId: string,
  state: EmailChatState,
  name: string,
  input: Record<string, unknown>,
  send: (event: EmailChatEvent) => void,
): Promise<unknown> {
  if (name === "look_at_email_html") {
    const html = state.html;
    return {
      html: html.length > MAX_HTML_CHARS ? `${html.slice(0, MAX_HTML_CHARS)}\n<!-- cut off -->` : html,
      note: state.partEdited ? "Part of the email was changed earlier in this reply; that change isn't in this copy." : undefined,
    };
  }

  if (name === "list_library_images") {
    const search = typeof input.search === "string" ? input.search.trim() : "";
    let q = admin
      .from("creative_assets")
      .select("id, name, public_url, mime_type, width, height, created_at")
      .order("created_at", { ascending: false })
      .limit(60);
    if (search) q = q.ilike("name", `%${search.replace(/[%_]/g, "")}%`);
    const { data, error } = await q;
    if (error) throw error;
    const pics = (data ?? []).filter((a) => a.mime_type && WEB_IMAGE_TYPES.includes(a.mime_type)).slice(0, 40);
    return pics.map((a) => ({ id: a.id, name: a.name, link: a.public_url, size: a.width && a.height ? `${a.width}x${a.height}` : null }));
  }

  if (name === "make_image" || name === "change_image") {
    const prompt = String((name === "make_image" ? input.description : input.instructions) ?? "").trim();
    const shape = ASPECTS.includes(input.shape as Aspect) ? (input.shape as Aspect) : name === "make_image" ? "16:9" : null;
    const sourceAssetId = name === "change_image" ? String(input.image_id ?? "") : null;
    if (name === "change_image" && !sourceAssetId) return { error: "Say which picture (image_id from list_library_images)." };
    const asset = await ernieImage(admin, userId, { prompt, sourceAssetId, aspect: shape, high: false });
    send({ type: "email_asset", asset: asset as unknown as Record<string, unknown> });
    const a = asset as unknown as { id: string; name: string; public_url: string };
    return {
      id: a.id,
      name: a.name,
      link: a.public_url,
      note: "Saved to the Creative Library and shown in the chat with a 'Put it in the email' button. To place it yourself, use edit_email with use_picture_ids.",
    };
  }

  if (name === "edit_email") {
    const part = input.part === "selected" ? "selected" : input.part === "new_section" ? "new_section" : "whole";
    const scope: EmailEditScope = part === "selected" ? "selection" : part === "new_section" ? "add" : "email";
    let prompt = String(input.instructions ?? "").trim();
    if (state.partEdited) {
      return { error: "Part of the email was already changed in this reply. Tell them what you did; they can ask for the next change." };
    }
    if (scope === "selection" && !state.ctx.selectionHtml) {
      return { error: "Nothing is selected in the designer. Ask them to click the part they mean, or change the whole email." };
    }
    if (scope === "selection" && state.html !== state.ctx.html) {
      return { error: "The email was already changed in this reply, so the selected part may have moved. Tell them; they can ask again." };
    }

    const useIds = Array.isArray(input.use_picture_ids) ? input.use_picture_ids.filter((x): x is string => typeof x === "string") : [];
    const pics = await libraryPictures(admin, useIds);
    if (pics.length > 0) {
      prompt += `\n\nUse these exact pictures (keep these src links exactly):\n${pics.map((p) => `- ${p.name}: ${p.public_url}`).join("\n")}`;
    }
    const rebuildId = typeof input.rebuild_from_picture_id === "string" && input.rebuild_from_picture_id ? input.rebuild_from_picture_id : null;

    const out = await ernieEditEmail(admin, userId, {
      prompt,
      scope,
      html: scope === "email" ? state.html : scope === "selection" ? (state.ctx.selectionHtml ?? "") : "",
      css: scope === "selection" ? (state.ctx.selectionCss ?? null) : null,
      fullEmailHtml: scope === "email" ? null : state.html,
      sourceAssetId: rebuildId,
    });
    if (scope === "email") state.html = out.html;
    else state.partEdited = true;
    send({ type: "email_edit", html: out.html, scope, note: out.note, swaps: out.swaps });
    return {
      done: true,
      what_changed: out.note,
      gray_picture_boxes_to_swap: out.swaps,
      note: "The change is in the designer now; they can Undo it. Tell them briefly what you changed (and about any gray 'Swap this picture' boxes).",
    };
  }

  return { error: `Unknown tool ${name}` };
}
