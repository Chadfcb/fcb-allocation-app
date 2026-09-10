// GitHub read access for Ernie's list_app_files / read_app_file tools
// (added 2026-09-09, per Chad: "i want ernie to have access to all the
// files"). This is the actual live source of truth for the app's own
// code — the same repo `git push` deploys from — read directly via
// GitHub's Contents API, so Ernie always sees the real, current file with
// zero manual transcription by Chad or Claude, unlike
// ernie_reference_documents (which is for facts/decisions that AREN'T
// already sitting in a file anywhere).
//
// Read-only, full stop: this file makes GET requests only. There is no
// function here that could write to the repo even if called wrong.
//
// Requires three Vercel environment variables:
//   GITHUB_TOKEN  — a fine-grained personal access token, "Contents:
//                   Read-only" permission, scoped to ONLY this one repo.
//                   Chad generates and sets this directly in Vercel; it
//                   is never pasted into chat or handled by Claude.
//   GITHUB_REPO   — "Chadfcb/fcb-allocation-app" (owner/repo). Defaults
//                   to that value below if the env var isn't set, since
//                   that's confirmed to be the real repo (.git/config).
//   GITHUB_BRANCH — defaults to "main" if unset.

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPO = "Chadfcb/fcb-allocation-app";
const DEFAULT_BRANCH = "main";

// A single file over this size isn't read in full — Ernie would rather
// get a clear "too big, ask for a narrower path" than silently blow past
// a reasonable amount of its own context on one file.
const MAX_READABLE_BYTES = 300_000;

interface GithubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
}

interface GithubFileContent extends GithubContentEntry {
  content?: string;
  encoding?: string;
}

function repoSlug(): string {
  return process.env.GITHUB_REPO || DEFAULT_REPO;
}

function branch(): string {
  return process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
}

async function githubContentsRequest(path: string): Promise<GithubContentEntry[] | GithubFileContent | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN isn't set in this environment yet — Chad needs to generate a read-only, contents-scoped token for this repo and set it in Vercel before this tool can work.",
    );
  }

  const cleanPath = path.replace(/^\/+/, "");
  const url = `${GITHUB_API}/repos/${repoSlug()}/contents/${cleanPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?ref=${branch()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // Never cache — Ernie should always see the current file, not a stale
    // build-time snapshot.
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error ${res.status} for "${cleanPath}": ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function listRepoPath(
  path: string,
): Promise<{ path: string; entries: { name: string; path: string; type: string; size: number }[] } | { error: string }> {
  const data = await githubContentsRequest(path || "");
  if (data === null) return { error: `No such path in the repo: "${path}".` };
  if (!Array.isArray(data)) {
    return { error: `"${path}" is a file, not a folder — use read_app_file to read it.` };
  }
  return {
    path: path || "(repo root)",
    entries: data.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size })),
  };
}

export async function readRepoFile(
  path: string,
): Promise<{ path: string; size: number; content: string } | { error: string }> {
  const data = await githubContentsRequest(path);
  if (data === null) return { error: `No such file in the repo: "${path}".` };
  if (Array.isArray(data)) {
    return { error: `"${path}" is a folder, not a file — use list_app_files to see what's inside it.` };
  }
  if (data.type !== "file") {
    return { error: `"${path}" isn't a readable file (type: ${data.type}).` };
  }
  if (typeof data.size === "number" && data.size > MAX_READABLE_BYTES) {
    return {
      error: `"${path}" is ${data.size.toLocaleString()} bytes, over the ${MAX_READABLE_BYTES.toLocaleString()}-byte limit for a single read. Ask about a smaller/more specific file instead.`,
    };
  }
  if (!data.content) {
    return { path: data.path, size: data.size, content: "" };
  }
  const content = Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  return { path: data.path, size: data.size, content };
}
