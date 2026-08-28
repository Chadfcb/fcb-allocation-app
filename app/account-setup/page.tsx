"use client";

// Shown once, right after someone signs in for the first time with a
// temporary password an admin set for them. They must pick their own
// password and enter their name before they can get into the app —
// app/(app)/layout.tsx redirects here whenever a profile's
// must_change_password flag is still true.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function AccountSetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError("Please enter your name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    const { error: passwordError } = await supabase.auth.updateUser({
      password,
    });
    if (passwordError) {
      setError(passwordError.message);
      setLoading(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Something went wrong — please sign in again.");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({ full_name: trimmedName, must_change_password: false })
      .eq("id", user.id)
      .select()
      .single();

    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    router.push(profile.role === "admin" ? "/dashboard" : "/inventory");
    router.refresh();
  }

  return (
    // Same background treatment as the sign-in page: the full logo behind
    // everything at its natural size (not cropped), the page's own
    // background matched to the logo's exact color (#121212, not pure
    // black) so the edges blend in seamlessly, and the card sitting on top
    // at 50% opacity so the logo shows through faintly.
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#121212] px-4">
      <Image
        src="/branding/fcb-logo.png"
        alt=""
        fill
        sizes="100vw"
        className="object-contain"
        priority
      />

      <div className="relative z-10 w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-950/50 p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-neutral-100">
          Welcome to FCB Data
        </h1>
        <p className="mb-6 text-sm text-neutral-400">
          First time signing in — set your own password and let us know your
          name.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">
              Your Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Dave Smith"
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">
              New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">
              Confirm Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-white px-3 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
