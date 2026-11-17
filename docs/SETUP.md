# Setting up ShowSchedule

One-time setup, about 20 minutes. After this, every change pushed to `main` goes live on its own.

## 1. Create the database (Supabase)

1. Sign up at [supabase.com](https://supabase.com) and create a **New project**. Pick a region near South Dakota (for example, *Central US*) and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste everything from [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**. You should see "Success. No rows returned."
3. Open **Project Settings → API** (or **Data API**) and copy:
   - the **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - the **anon / public** key (a long string starting with `eyJ...`, or a *publishable* key starting with `sb_publishable_`)

   Do **not** use the `service_role` or *secret* key anywhere in this project.

## 2. Turn on the website (GitHub Pages)

1. In this repository on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. GitHub Pages on a **private** repository requires a paid GitHub plan (Pro, Team or Enterprise). On a free account, make the repository public under **Settings → General → Danger Zone → Change visibility**. The code holds no passwords and no family data, so that's safe.
3. Your site address will be `https://andydeinert81-oss.github.io/ShowSchedule/`. You can add your own domain later under **Settings → Pages → Custom domain**.

## 3. Connect the site to the database

Put the two values from step 1 into [`web/config.js`](../web/config.js):

```js
export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

Commit and push (or send them to Claude and it'll do it). The **Actions** tab shows the deploy. It takes about a minute.

## 4. Tell Supabase where the site lives

In Supabase: **Authentication → URL Configuration**

- **Site URL:** `https://andydeinert81-oss.github.io/ShowSchedule/`
- **Redirect URLs:** add the same address

This makes sign-up confirmation and password-reset emails link back to your site.

Supabase's built-in email sender is limited to a few emails per hour, which is fine for testing. Before opening sign-ups to everyone, set up your own email sender under **Authentication → Emails → SMTP Settings** (for example Resend, Postmark or SendGrid).

## 5. Create your admin account and bring over your data

1. Open the site, tap **Log in → Create account**, and sign up. **The first account created becomes the admin.** Do this before you share the link.
2. Confirm your email if asked, then log in.
3. In Supabase **SQL Editor**, run the one-time import file Claude gave you (`import-claude-data.sql`). It is **not** in this repository because it contains your family's data. It moves your shows, series, entries and barn to your new login.

## 6. Let admins add users from the site (optional)

The **Users** page can create accounts, reset passwords and remove accounts. Doing that needs Supabase's private admin key, which must never be in the website, so it runs as a small **Edge Function** on Supabase's servers. The function only does anything when the request comes from a logged-in admin.

1. In Supabase, open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly **`admin-users`**.
3. Replace the sample code with everything in [`supabase/functions/admin-users/index.ts`](../supabase/functions/admin-users/index.ts) (use **Copy raw file** on GitHub), then click **Deploy**.
4. Open the function's **Details** (or **Settings**) and turn **off** "Verify JWT with legacy secret" (it may be labeled "Enforce JWT verification"), then save. The function checks the caller's login and admin role itself, and Supabase's newer keys don't work with the legacy check.
5. Reload the site's **Users** page. An **+ Add user** button appears.

**Or let GitHub deploy it for you** (and redeploy it whenever the function changes):
1. In Supabase, click your avatar → **Account preferences → Access Tokens → Generate new token**. Name it `GitHub deploy` and copy it.
2. In this GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**. Name: `SUPABASE_ACCESS_TOKEN`, value: the token. Save.
3. Go to **Actions → Deploy Supabase functions → Run workflow**. When it shows a green check, the function is live with JWT verification already off.

The token can manage your whole Supabase account, so keep it only in GitHub Secrets (never in the code) and delete it in Supabase if you stop using this.

If you prefer the command line: `supabase functions deploy admin-users --no-verify-jwt`.

When adding someone you can either:
- **Give them a temporary password**: the account works right away. Share the login details (there's a Copy button), and they can change the password under **Account → Change password**.
- **Email them an invite link**: Supabase sends the email. Its built-in sender only allows a few emails an hour, so for many families use temporary passwords or set up an email service (step 4).

## Roles

| Role | Can |
|---|---|
| Anyone (no login) | Follow shows live, see results and series standings |
| Exhibitor | Keep a private barn, enter shows while entries are open, withdraw |
| Show manager | Everything above, plus create shows and series and run the shows they manage (settings, entries, order, ring, placings) |
| Admin | Everything, plus change anyone's role on the **Users** page |

Any account can be added as a co-manager of a specific show from that show's settings.

## Making changes later

Ask Claude for the change in this project. It edits the code, tests it, and pushes to `main`. GitHub Actions republishes the site automatically.

Once the `SUPABASE_ACCESS_TOKEN` secret is set (step 6), changes to `supabase/schema.sql` are applied to the database automatically by the **Apply database schema** workflow, and changes to the function are deployed by **Deploy Supabase functions**. Without the secret, re-run `supabase/schema.sql` in the SQL Editor yourself. It's safe to re-run.
