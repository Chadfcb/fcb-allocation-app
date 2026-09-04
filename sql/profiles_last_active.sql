-- "Last Active" tracking for the Users page — added 2026-09-05, per Chad:
-- Supabase's own auth "last sign in" was showing August for every user,
-- even people who'd clearly used the app today. That's because Supabase
-- only updates last_sign_in_at on a fresh login (password/OTP/magic link)
-- — once someone's session is active, the app keeps them signed in by
-- silently refreshing their token in the background, which Supabase does
-- NOT count as a new sign-in. So last_sign_in_at reflects "last time this
-- person typed their password," not "last time they used the app."
--
-- This adds a last_active_at column that the app itself keeps current
-- (see lib/getProfile.ts, throttled to roughly once every 5 minutes per
-- person) every time someone actually loads a page — a real "used the app
-- today" signal, shown on the Users page between Joined and Role.
--
-- Run this once in Supabase's SQL Editor, before the matching code
-- deploy. Idempotent — safe to re-run.

alter table profiles add column if not exists last_active_at timestamptz;

-- No RLS change needed — the existing "profiles_update_self_or_admin"
-- policy already lets a signed-in person update their own profile row
-- (auth.uid() = id), which is what lib/getProfile.ts relies on to write
-- this column for themselves.
