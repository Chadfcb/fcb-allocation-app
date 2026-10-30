"use client";

import { useState, type ReactNode } from "react";

// Email Studio → How to use (added 2026-10-30, per Chad: "we need an
// instructional section in the email studio, or even a tutorial", written
// for whoever designs the emails — that person creates them, someone else
// picks who gets them and sends). Per Chad: no names in the guide.
// Used as the "How to use" tab and, in compact form, as the "?" side panel
// in the email designer. Keep the steps in sync with the real screens
// (EmailDesignerClient, ErnieStudioPanel, EmailStudioClient, EmailSendDialog,
// EmailSentTab) when those change.

type Section = { id: string; title: string; who: "create" | "send"; body: ReactNode };

const K = ({ children }: { children: ReactNode }) => <strong className="text-neutral-100">{children}</strong>;
const Steps = ({ children }: { children: ReactNode }) => <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
const Bullets = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
const Tip = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">💡 {children}</p>
);

export const GUIDE_SECTIONS: Section[] = [
  {
    id: "quick-start",
    title: "Quick start — your first email in 6 steps",
    who: "create",
    body: (
      <>
        <Steps>
          <li>
            On the <K>Emails</K> tab, click <K>+ New email</K>. It opens with a starter layout (logo, headline, text, a green button).
          </li>
          <li>
            Give it a <K>name</K> (top left — only you see this), a <K>subject line</K> and <K>preview text</K> (the grey line after the
            subject in most inboxes).
          </li>
          <li>
            Click on anything in the email to change it: double-click text to type, double-click an image to swap it. Drag new pieces in from
            the blocks panel.
          </li>
          <li>
            Click <K>Save</K> (or press Ctrl+S / Cmd+S). Saving often is a good habit — the page warns you if you try to leave with unsaved
            changes.
          </li>
          <li>
            Click <K>Send me a test</K> to get the real email in your own inbox. Check it on your phone too.
          </li>
          <li>
            When it&apos;s finished, change the status from <K>Draft</K> to <K>Ready</K> and save. That tells whoever sends emails it&apos;s good to go.
          </li>
        </Steps>
        <Tip>You don&apos;t need to add an address or unsubscribe link — every email gets the FCB address and an Unsubscribe link at the bottom automatically when it&apos;s sent.</Tip>
      </>
    ),
  },
  {
    id: "designing",
    title: "Designing an email",
    who: "create",
    body: (
      <>
        <p>
          <K>The screen:</K> the email is in the middle. The buttons along the top of the design area switch between the panels on the
          right: <K>blocks</K> (the grid icon — pieces you can drag in), <K>style</K> (the paintbrush — colors, sizes, spacing),{" "}
          <K>settings</K> (the gear — things like a link&apos;s address) and <K>layers</K> (a list of everything in the email, handy for
          picking small things).
        </p>
        <p className="font-semibold text-neutral-100">Adding things</p>
        <Steps>
          <li>Open the blocks panel and drag a block (Text, Image, Button, Divider, Sections with 1–3 columns, and more) into the email.</li>
          <li>A green line shows where it will land. Let go to drop it.</li>
        </Steps>
        <p className="font-semibold text-neutral-100">Changing things</p>
        <Bullets>
          <li>
            <K>Text:</K> double-click it and type. A small bar appears for bold, italic and links.
          </li>
          <li>
            <K>Images:</K> double-click an image to open the picker — choose from the Creative Library or upload a new file right there.
          </li>
          <li>
            <K>Buttons and links:</K> click it, then use the gear (settings) panel to set where it goes.
          </li>
          <li>
            <K>Colors, sizes, spacing:</K> click the piece, then open the paintbrush (style) panel.
          </li>
          <li>
            <K>Move or delete:</K> click a piece — a small toolbar appears on it with a move handle (drag it), copy and trash.
          </li>
          <li>
            <K>Oops:</K> undo / redo are in the top toolbar (or Ctrl+Z / Cmd+Z).
          </li>
        </Bullets>
        <p className="font-semibold text-neutral-100">Checking how it looks</p>
        <Bullets>
          <li>Use the desktop / tablet / phone buttons at the top to see it at each size — most people read email on a phone.</li>
          <li>
            <K>Preview email</K> shows the full email the way it will go out, footer included.
          </li>
        </Bullets>
        <Tip>Keep important words in real text, not baked into a picture — some inboxes hide pictures until the reader taps &ldquo;show images&rdquo;, and real text is readable either way.</Tip>
        <p className="font-semibold text-neutral-100">Copies and old emails</p>
        <Bullets>
          <li>
            On the <K>Emails</K> tab, <K>Duplicate</K> makes a copy — a quick way to start next month&apos;s email from this one.
          </li>
          <li>
            <K>Remove</K> hides an email from the list (it asks twice first).
          </li>
        </Bullets>
      </>
    ),
  },
  {
    id: "library",
    title: "Creative Library — your images and files",
    who: "create",
    body: (
      <>
        <p>Everything you use in emails lives here: images, GIFs, Photoshop and Illustrator files, videos and PDFs (up to 50 MB each).</p>
        <Steps>
          <li>
            Open the <K>Creative Library</K> tab and drag files onto the dashed box (or click it to choose files).
          </li>
          <li>Images you add here show up in the designer&apos;s image picker in every email.</li>
          <li>Use the filters (Images, GIFs, Photoshop / Illustrator, Videos) and the search box to find things.</li>
          <li>
            Each file has <K>Copy link</K>, <K>Download</K> and <K>Delete</K>.
          </li>
        </Steps>
        <p className="font-semibold text-neutral-100">Photoshop (.psd) and Illustrator (.ai) files</p>
        <Bullets>
          <li>
            Email apps can only show regular pictures (PNG, JPG, GIF). When you upload a .psd or .ai, an email-ready PNG copy is made
            automatically and appears next to it, named &ldquo;(from Photoshop)&rdquo; or &ldquo;(from Illustrator)&rdquo;. Use that copy in the email.
          </li>
          <li>
            Files uploaded before this feature existed have a <K>Make email copy</K> link.
          </li>
          <li>
            If a copy can&apos;t be made, you&apos;ll see why. Usual fixes: save Photoshop files with <K>Maximize Compatibility</K> on and in{" "}
            <K>RGB</K> color (not CMYK); save Illustrator files with <K>Create PDF Compatible File</K> checked. Or just export a PNG.
          </li>
          <li>It&apos;s a flat picture copy — to change layers or text, edit in Photoshop/Illustrator and upload again.</li>
        </Bullets>
        <p className="font-semibold text-neutral-100">Canva designs</p>
        <p>
          In Canva: <K>Share → Download</K>, pick PNG or JPG (or GIF for motion), then drag the file into the Creative Library. The{" "}
          <K>Bringing in Canva designs</K> box at the top of the Creative Library tab has the full steps.
        </p>
        <p className="font-semibold text-neutral-100">Sizes that work best</p>
        <Bullets>
          <li>
            Emails are about <K>600 pixels wide</K>. Make full-width images about <K>1200 pixels wide</K> so they stay sharp on phones.
          </li>
          <li>Keep each image under about 1 MB and GIFs under about 5 MB so the email loads fast.</li>
          <li>Videos can&apos;t play inside most email apps — use a GIF for motion, or an Ernie animation (it adds a &ldquo;Watch the video&rdquo; button).</li>
        </Bullets>
      </>
    ),
  },
  {
    id: "ernie",
    title: "Using Ernie to create, edit and animate images",
    who: "create",
    body: (
      <>
        <p>
          In the email designer, click <K>✨ Ernie</K> (top right). A panel opens with three tabs. Everything Ernie makes is saved to the
          Creative Library automatically.
        </p>
        <Bullets>
          <li>
            <K>Create:</K> describe the image, pick a <K>Shape</K> (wide banner, square, portrait…) and <K>Quality</K> (Standard is best for
            email), then click <K>Create image</K>. Takes about 15–40 seconds.
          </li>
          <li>
            <K>Edit:</K> pick an image from the library and say what should change (&ldquo;make the background a sunset&rdquo;). The original
            stays; you get a new copy.
          </li>
          <li>
            <K>Animate:</K> pick an image, describe the motion, choose 4–8 seconds. It takes 1–3 minutes — keep working, it shows up in the
            panel when done.
          </li>
        </Bullets>
        <p>
          When it&apos;s done: <K>Put it in the email</K> (lands right after whatever you have selected — or replaces the selected image),{" "}
          <K>Make changes to it</K>, or <K>Animate it</K>.
        </p>
        <p className="font-semibold text-neutral-100">Writing a good description</p>
        <Bullets>
          <li>Say the subject, setting, style, colors and mood: &ldquo;A frosty can of pumpkin ale on a rustic wooden bar, autumn leaves, warm evening light, photo style, no text.&rdquo;</li>
          <li>Ask for &ldquo;no text&rdquo; and add the words yourself in the email — AI lettering is often misspelled.</li>
          <li>Ernie won&apos;t make real people or other companies&apos; logos.</li>
          <li>For animations, describe movement: &ldquo;slow camera push in, condensation drips down the can, leaves drift past.&rdquo;</li>
        </Bullets>
        <p className="font-semibold text-neutral-100">Cost and limits</p>
        <Bullets>
          <li>Each image costs about $0.13 (about $0.24 at the highest quality). An 8-second animation is roughly $3.</li>
          <li>
            There&apos;s a monthly limit of <K>100 images</K> and <K>10 animations</K>. The top of the Ernie panel shows how many are used and
            the cost so far. It resets on the 1st.
          </li>
          <li>Only ask for what you&apos;ll use — a few good tries beats a dozen variations.</li>
        </Bullets>
      </>
    ),
  },
  {
    id: "rules",
    title: "Rules every email has to follow",
    who: "create",
    body: (
      <Bullets>
        <li>The FCB address and Unsubscribe link are added at the bottom automatically — don&apos;t add a second one, and never hide it.</li>
        <li>Subject lines have to be honest about what&apos;s in the email.</li>
        <li>It&apos;s beer: don&apos;t use anyone who looks under 21, and don&apos;t aim anything at people under 21.</li>
        <li>Only use images FCB owns or made (your own work, Ernie, Canva with FCB&apos;s account) — not pictures pulled off the internet.</li>
        <li>
          Always <K>Send me a test</K> and check it on a phone before marking an email <K>Ready</K>.
        </li>
      </Bullets>
    ),
  },
  {
    id: "audience",
    title: "Picking who gets an email",
    who: "send",
    body: (
      <>
        <p>
          The <K>Audience</K> tab holds your lists and the Do Not Email list. You choose who gets each email when you send it.
        </p>
        <Bullets>
          <li>
            <K>Account contacts</K> come straight from Accounts — anyone with an email on file. When sending, you can narrow by distributor,
            on/off premise, and how recently they bought from us.
          </li>
          <li>
            <K>Import from Mailchimp:</K> in Mailchimp, Audience → All contacts → Export Audience. Import the <K>subscribed</K> file as a new
            list, and the <K>unsubscribed</K> and <K>cleaned</K> files into Do Not Email so those people are never emailed.
          </li>
          <li>
            <K>New list from pasted addresses</K> — paste emails separated by commas or new lines.
          </li>
          <li>
            <K>Do Not Email</K> — people here are always left out. Unsubscribes are added automatically. Nobody can be removed from it in the
            app (an unsubscribe has to stay honored).
          </li>
        </Bullets>
      </>
    ),
  },
  {
    id: "sending",
    title: "Sending an email",
    who: "send",
    body: (
      <>
        <Steps>
          <li>
            Open an email marked <K>Ready</K> on the Emails tab and click <K>Send…</K> (top right of the designer).
          </li>
          <li>Pick who gets it: account contacts (with filters), any lists, and extra addresses. The big number shows exactly how many people.</li>
          <li>
            Click <K>Show who&apos;s included</K> to spot-check the list.
          </li>
          <li>
            Check the <K>From name</K> (default &ldquo;Full Circle Brewing&rdquo;) and where <K>replies</K> go (default ernie@fullcirclebrewing.com).
          </li>
          <li>
            Choose <K>Send now</K> or <K>Schedule</K> (up to 60 days ahead).
          </li>
          <li>
            Tick <K>I sent myself a test and it looks right</K>, then click Send.
          </li>
        </Steps>
        <p className="font-semibold text-neutral-100">How it goes out</p>
        <Bullets>
          <li>Emails go out from ernie@fullcirclebrewing.com a few at a time, 7am–6pm Pacific, up to 1,800 a day.</li>
          <li>Bigger sends finish over several days on their own — the Send box tells you how many days before you send.</li>
          <li>Anyone who unsubscribes partway through is skipped automatically.</li>
        </Bullets>
        <Tip>Hold off on very large sends until the company email security setting (DKIM) is turned on — it helps emails land in inboxes instead of spam.</Tip>
      </>
    ),
  },
  {
    id: "results",
    title: "Reading the results",
    who: "send",
    body: (
      <>
        <p>
          The <K>Sent</K> tab lists every email sent or scheduled. The line at the top shows how many went out today out of the 1,800 limit.
        </p>
        <Bullets>
          <li>
            <K>Sent</K> — handed off to email so far. <K>Waiting</K> — still in line (goes out over the coming hours/days).
          </li>
          <li>
            <K>Opened</K> — approximate. Some email apps count every email as opened; some block pictures so opens never show.
          </li>
          <li>
            <K>Clicked</K> — people who clicked a link. The most reliable sign of interest.
          </li>
          <li>
            <K>Unsubscribed</K> — they&apos;re on Do Not Email now and won&apos;t get future emails.
          </li>
          <li>
            <K>Pause</K>, <K>Resume</K> and <K>Cancel</K> work on any email that&apos;s still going out. Cancel skips everyone still waiting
            (it asks twice).
          </li>
        </Bullets>
        <p className="font-semibold text-neutral-100">Bounced emails</p>
        <p>
          Addresses that don&apos;t exist anymore come back as &ldquo;delivery failed&rdquo; emails in the ernie@fullcirclebrewing.com inbox. Add
          those addresses on the Audience tab under <K>Add to do-not-email</K> so they&apos;re skipped next time — lots of bounces can hurt
          where our emails land.
        </p>
      </>
    ),
  },
];

/** The guide. compact = the narrow "?" side panel in the designer. */
export default function EmailStudioGuide({ compact = false, initialOpen = "quick-start" }: { compact?: boolean; initialOpen?: string }) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const group = (who: "create" | "send", heading: string, sub: string) => (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">{heading}</h2>
        <p className="text-xs text-neutral-500">{sub}</p>
      </div>
      {GUIDE_SECTIONS.filter((s) => s.who === who).map((s) => (
        <div key={s.id} id={`guide-${s.id}`} className="rounded-xl border border-neutral-800 bg-neutral-900/40">
          <button
            type="button"
            onClick={() => setOpen((o) => (o === s.id ? null : s.id))}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            aria-expanded={open === s.id}
          >
            <span className="font-semibold text-neutral-100">{s.title}</span>
            <span className="shrink-0 text-xs text-neutral-500">{open === s.id ? "Hide" : "Show"}</span>
          </button>
          {open === s.id && <div className="space-y-3 border-t border-neutral-800 px-4 py-3 text-sm leading-relaxed text-neutral-300">{s.body}</div>}
        </div>
      ))}
    </div>
  );
  return (
    <div className={compact ? "space-y-5" : "max-w-3xl space-y-6"}>
      {group("create", "Creating emails", "Designing, images, Ernie, and marking emails Ready.")}
      {group("send", "For whoever sends", "Choosing who gets an email, sending it, and reading the results.")}
    </div>
  );
}
