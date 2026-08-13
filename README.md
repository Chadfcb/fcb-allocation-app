# FCB Allocation

A shared, browser-based web app for Full Circle Brewing's weekly distributor
allocation workflow — replaces the "Inventory for Sale" spreadsheet.

Each week you track your own available inventory (on hand / unlabeled / to be
packaged) per product, pull in each distributor's current inventory and rate
of sale (from VIP, Ekos, or the distributor directly), see a suggested order
per distributor per product, and allocate your inventory across distributors
while watching remaining inventory update live. Starting a new week
automatically carries forward remaining inventory from the prior week.

Up to 5 people can sign in with their own account. Admins can start new
weeks, manage users, and view/undo the full change history. Everyone can
enter inventory, distributor data, and allocations.

## One-time setup (free tier)

1. **Create a free Supabase project** at [supabase.com](https://supabase.com).
   In the project's SQL Editor, run these three files in order:
   - `supabase/schema.sql`
   - `supabase/functions.sql`
   - `supabase/seed.sql` (loads your real distributor + product list so you're
     not starting from a blank slate — edit it first if you want to change
     anything)
2. In your Supabase project, go to **Project Settings > API** and copy the
   **Project URL** and **anon public key**.
3. Copy `.env.local.example` to `.env.local` and paste those two values in.
4. **Create your first user**: in Supabase, go to **Authentication > Users >
   Add User** and create an account for yourself (email + password). The
   very first user to sign up automatically becomes an Admin — everyone
   after that starts as a Basic user (you can promote them from the Users
   page inside the app).
5. **Start a week**: sign in, go to Weeks (Admin), and start your first week
   so there's something to enter data against.

## Deploying (free tier)

1. Push this repo to GitHub (same pattern as your other FCB apps).
2. Create a free [Vercel](https://vercel.com) account, import the GitHub
   repo, and add the two environment variables from `.env.local` in the
   Vercel project settings.
3. Deploy — Vercel gives you a live URL you and your team can use from any
   browser.

## Adding more people

Add each teammate from Supabase's **Authentication > Users > Add User**
screen (up to 5 total for now). They'll show up in the app's Users page as
soon as they sign in for the first time, defaulted to Basic — promote them
to Admin there if needed.

## Local development

```bash
npm install
npm run dev
```

## What's deliberately not built yet

- Sales rep commitments (a future layer on top of suggested orders) — set
  aside for now per Chad, to keep the foundation focused.
- A dedicated screen for managing the product/distributor master list —
  for now, add/edit/deactivate those directly in the Supabase table editor,
  or by editing `supabase/seed.sql`.
- Self-service sign-up — new users are added by an admin via Supabase, not
  a public sign-up form, since this is an internal tool for a small team.
