// Picks a friendly first name to greet a user with (e.g. "Welcome, Dave").
// Prefers the name they set during account setup; falls back to guessing
// from their email's local part for anyone who hasn't been through that
// flow (e.g. the original admin account, created before this feature
// existed, or anyone whose password predates it).
export function firstNameFor(profile: { full_name: string | null; email: string }): string {
  const fullName = profile.full_name?.trim();
  if (fullName) {
    return fullName.split(/\s+/)[0];
  }

  const local = profile.email.split("@")[0] ?? "";
  const guess = local.split(/[._-]+/)[0] || local;
  return guess.charAt(0).toUpperCase() + guess.slice(1);
}
