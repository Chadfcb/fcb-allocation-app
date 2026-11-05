import type { createAdminClient } from "@/lib/supabase/admin";
import { assertUnderCap, loadSourceImage } from "@/lib/email/ernieStudio";
import { ERNIE_SWAP_SRC } from "@/lib/email/erniePlaceholder";

type Admin = ReturnType<typeof createAdminClient>;

// Ernie → "Edit email" (added 2026-11-05, per Chad after Eddie asked for "an
// edit button where it goes in and writes or fixes stuff when asked" →
// "build it"). Server-only.
//
// Ernie works on the email ITSELF, not a picture:
//   * change the whole email or just the part that's selected in the designer
//     (rewrite/fix text, add a button, change colors, move sections…), or
//   * rebuild a picture of a design (a flyer, a mockup) as a real, editable
//     email — real text, buttons and colors. Photos inside the design can't be
//     cut out, so each one becomes a gray "Swap this picture" box.
//
// Uses Google's fast text model on the same GEMINI_API_KEY as the rest of
// Ernie (no new account). Text only, so it's cheap: about 2–5¢ an edit,
// worked out from the real token counts Google sends back. Own monthly cap
// (MONTHLY_EMAIL_EDIT_CAP in ernieStudio.ts).

// Google's fast model first; if Google doesn't know it, the older one.
const MODELS = ["gemini-3-flash-preview", "gemini-2.5-flash"];
// Price per token for the estimate (Gemini Flash list price: $0.50 per
// million in, $3 per million out). Thinking counts as output.
const COST_IN = 0.5 / 1_000_000;
const COST_OUT = 3 / 1_000_000;
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 240000;
const MAX_INPUT_CHARS = 400_000;
const LOGO_URL = "https://www.fcb-data.com/branding/fcb-logo.png";

// email = change the whole email · selection = change the selected part ·
// add = make a new section to drop in (after the selected part, or at the end)
export type EmailEditScope = "email" | "selection" | "add";

const RULES = `You are Ernie, the email designer's assistant at Full Circle Brewing Co. (a craft brewery in Fresno, CA).
You edit HTML emails that are opened in a drag-and-drop email designer and sent to bars, restaurants and stores that sell our beer.

How to write the HTML:
- Email-safe HTML only: tables for layout (role="presentation", cellpadding="0", cellspacing="0", border="0"), all styles INLINE in style="" attributes, max width 600px, web-safe fonts (Arial, Helvetica, Georgia, Verdana).
- No <script>, <style>, <form>, <input>, <iframe>, <video>, no JavaScript, no CSS classes that need a stylesheet.
- Keep every existing image exactly as it is (same src) unless asked to remove it. NEVER invent image links.
- Where a new photo or picture is needed, use <img src="ERNIE_PHOTO" alt="what the picture should show" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"> — the designer swaps it for a real picture.
- The Full Circle Brewing logo, if needed, is ${LOGO_URL}
- Buttons are <a> links styled as buttons (background-color, padding, border-radius, bold text). Our green is #6ABC46 with black text.
- Do NOT add an address, footer or unsubscribe link — one is added automatically when the email is sent.
- Keep it honest: no fake prices, deals, dates or claims that weren't given to you. Never aim anything at people under 21.
- Spell carefully. Keep the existing wording unless asked to change it.

How to answer — exactly this, nothing else:
<ernie-note>One or two plain-English sentences saying what you changed (for the designer to read).</ernie-note>
<ernie-html>
...the HTML...
</ernie-html>`;

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("Ernie isn't set up on the server (GEMINI_API_KEY missing).");
  return k;
}

async function callGeminiText(parts: GeminiPart[]): Promise<{ text: string; cost: number }> {
  let lastErr = "Couldn't reach Ernie.";
  for (const model of MODELS) {
    const send = (withThinking: boolean) =>
      fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: RULES }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 32000,
            ...(withThinking
              ? { thinkingConfig: model.startsWith("gemini-3") ? { thinkingLevel: "low" } : { thinkingBudget: 1024 } }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    let res: Response;
    try {
      res = await send(true);
      // If Google ever rejects the thinking setting, try once without it.
      if (res.status === 400) {
        const t = await res.clone().text();
        if (/thinking/i.test(t)) res = await send(false);
      }
    } catch (e) {
      throw new Error(e instanceof Error && e.name === "TimeoutError" ? "Ernie took too long — try a smaller change, or just the selected part." : "Couldn't reach Ernie.");
    }
    if (res.status === 404) {
      lastErr = `Ernie's model ${model} isn't available.`;
      continue; // try the next model
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Ernie couldn't do that (HTTP ${res.status}). ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const cand = json?.candidates?.[0];
    if (cand?.finishReason === "MAX_TOKENS") {
      throw new Error("That email is too long for Ernie to redo in one go — select one part of it and use “Just the selected part”.");
    }
    const text = ((cand?.content?.parts ?? []) as GeminiPart[])
      .map((p) => p.text ?? "")
      .join("");
    const u = json?.usageMetadata ?? {};
    const cost =
      (Number(u.promptTokenCount) || 0) * COST_IN + ((Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0)) * COST_OUT;
    return { text, cost };
  }
  throw new Error(lastErr);
}

/** Collects every image src in a piece of HTML. */
function imageSrcs(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/gi)) out.add(m[2].replace(/&amp;/g, "&"));
  return out;
}

/** Strips anything that isn't safe or doesn't belong in an email, and fixes image links. */
function cleanHtml(html: string, allowedSrcs: Set<string>): { html: string; swaps: number } {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|form|textarea|select|video|audio|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|style|iframe|object|embed|form|input|textarea|select|button|link|meta|base|video|audio|html|head|body|!doctype)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  let swaps = 0;
  h = h.replace(/(<img\b[^>]*?\ssrc\s*=\s*)(["'])(.*?)\2/gi, (_all, pre: string, q: string, src: string) => {
    const real = src.replace(/&amp;/g, "&");
    if (real === LOGO_URL || allowedSrcs.has(real)) return `${pre}${q}${src}${q}`;
    swaps++;
    return `${pre}${q}${ERNIE_SWAP_SRC}${q}`;
  });
  return { html: h.trim(), swaps };
}

function parseAnswer(text: string): { note: string; html: string } {
  const note = text.match(/<ernie-note>([\s\S]*?)<\/ernie-note>/i)?.[1]?.trim() ?? "";
  let html = text.match(/<ernie-html>([\s\S]*?)(<\/ernie-html>|$)/i)?.[1] ?? "";
  if (!html.trim()) {
    // Fall back to any HTML in the answer (e.g. inside a ``` block).
    const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i)?.[1];
    html = fenced ?? (/<table|<div|<p\b/i.test(text) ? text.replace(/<ernie-note>[\s\S]*?<\/ernie-note>/i, "") : "");
  }
  html = html.replace(/^\s*```(?:html)?/i, "").replace(/```\s*$/i, "").trim();
  return { note, html };
}

/**
 * Ernie edits the email. `html` is the part being changed (the whole email,
 * or the selected part); `fullEmailHtml` is the whole email for context when
 * only a part is being changed. `sourceAssetId` = a Creative Library picture
 * to rebuild / copy from.
 */
export async function ernieEditEmail(
  admin: Admin,
  userId: string,
  opts: {
    prompt: string;
    scope: EmailEditScope;
    html: string;
    css?: string | null;
    fullEmailHtml?: string | null;
    sourceAssetId?: string | null;
  },
): Promise<{ html: string; note: string; swaps: number }> {
  const prompt = opts.prompt.trim();
  const html = (opts.html ?? "").trim();
  if (!prompt && !opts.sourceAssetId) throw new Error("Tell Ernie what to change.");
  if (opts.scope === "selection" && !html) throw new Error("Select a part of the email first.");
  const total = html.length + (opts.css?.length ?? 0) + (opts.fullEmailHtml?.length ?? 0) + prompt.length;
  if (total > MAX_INPUT_CHARS) throw new Error("That email is too big for Ernie — select one part of it and try again.");
  await assertUnderCap(admin, "email");

  const parts: GeminiPart[] = [];
  let source: Awaited<ReturnType<typeof loadSourceImage>> | null = null;
  if (opts.sourceAssetId) {
    source = await loadSourceImage(admin, opts.sourceAssetId);
    parts.push({ inlineData: { mimeType: source.mime, data: source.buffer.toString("base64") } });
  }

  const ask: string[] = [];
  const copy =
    "Type out every word you can read in the picture exactly as written. Every photo, illustration or product shot in it becomes an ERNIE_PHOTO image with an alt that describes it. Plain colored areas become background colors.";
  if (opts.scope === "add") {
    ask.push(
      source
        ? "The picture above is a design to copy. Rebuild it as real, editable email HTML (real text, buttons, colors and layout — match it as closely as you can)."
        : "Make a NEW section for this email.",
      "It will be ADDED into the existing email shown below, so return only the new section: one 600px-wide table (width=\"100%\" style=\"max-width:600px\"), no outer page background, matching the email's look.",
    );
    if (source) ask.push(copy);
  } else if (source) {
    ask.push(
      opts.scope === "selection"
        ? "The picture above is a design to copy. Rebuild it as real, editable email HTML (real text, buttons, colors and layout — match it as closely as you can) to REPLACE the selected part shown below."
        : html
          ? "The picture above is a design to copy. Rebuild it as real, editable email HTML (real text, buttons, colors and layout — match it as closely as you can). It will REPLACE the whole email shown below."
          : "The picture above is a design to copy. Rebuild it as a complete, real, editable email (real text, buttons, colors and layout — match it as closely as you can).",
      copy,
    );
  }
  if (prompt) ask.push(`What the designer asked for: ${prompt}`);
  if (opts.scope === "selection") {
    if (opts.fullEmailHtml) ask.push(`The whole email, for context only (do NOT return it):\n${opts.fullEmailHtml}`);
    ask.push(
      `The SELECTED PART to change — return only its replacement, starting with the same kind of tag (if it is a <td>, return a <td>; a <tr>, return a <tr>):\n${html}`,
      opts.css ? `Styles that currently apply to the selected part (put what you keep inline):\n${opts.css}` : "",
    );
  } else if (opts.scope === "add") {
    if (opts.fullEmailHtml) ask.push(`The existing email, for context only (do NOT return it):\n${opts.fullEmailHtml}`);
  } else if (html) {
    ask.push(`The whole email right now — return the whole changed email:\n${html}`);
  }
  parts.push({ text: ask.filter(Boolean).join("\n\n") });

  const { data: job } = await admin
    .from("creative_ernie_jobs")
    .insert({
      kind: "email",
      prompt: prompt || "(rebuild the picture as an email)",
      source_asset_id: source?.id ?? null,
      settings: { scope: opts.scope, rebuild: !!source },
      cost_estimate: 0.05,
      created_by: userId,
    })
    .select("id")
    .single();

  try {
    const { text, cost } = await callGeminiText(parts);
    const ans = parseAnswer(text);
    if (!ans.html || !/<[a-z][\s\S]*>/i.test(ans.html)) {
      throw new Error(ans.note ? `Ernie didn't change the email: ${ans.note.slice(0, 250)}` : "Ernie didn't send back an email — try asking differently.");
    }
    const allowed = imageSrcs(`${html}\n${opts.fullEmailHtml ?? ""}`);
    const withPhotos = ans.html.replace(/ERNIE_PHOTO/g, "ernie-photo-placeholder");
    const cleaned = cleanHtml(withPhotos, allowed);
    if (!cleaned.html) throw new Error("Ernie's answer was empty — try again.");
    if (job) {
      await admin
        .from("creative_ernie_jobs")
        .update({ status: "done", cost_estimate: Math.round(cost * 1000) / 1000, updated_at: new Date().toISOString() })
        .eq("id", job.id);
    }
    return { html: cleaned.html, note: ans.note, swaps: cleaned.swaps };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (job) await admin.from("creative_ernie_jobs").update({ status: "error", error: msg.slice(0, 500), cost_estimate: 0, updated_at: new Date().toISOString() }).eq("id", job.id);
    throw e;
  }
}
