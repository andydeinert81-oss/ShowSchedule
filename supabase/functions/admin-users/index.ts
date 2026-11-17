// ShowSchedule — admin user management (Supabase Edge Function "admin-users").
//
// Runs on Supabase's servers, where the project's secret key is available automatically.
// That key never reaches the website. Every request must come from a logged-in
// account whose profile role is 'admin'; anyone else gets a 403.
//
// Actions (POST JSON body):
//   { action: 'list' }                                                   → users with email + last sign-in
//   { action: 'create', name, email, role, mode: 'password', password }  → account ready to use now
//   { action: 'create', name, email, role, mode: 'invite', redirectTo }  → Supabase emails an invite link
//   { action: 'setPassword', id, password }                              → set a new temporary password
//   { action: 'delete', id }                                             → remove the account (not yourself)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ROLES = ['exhibitor', 'manager', 'admin'];

// The server-side key. Newer projects provide SUPABASE_SECRET_KEYS, a JSON dictionary of
// secret keys like {"default":"sb_secret_..."}; older ones provide SUPABASE_SERVICE_ROLE_KEY.
function serverKey(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      const k = keys.default || Object.values(keys)[0];
      if (k) return String(k);
    } catch { /* fall through to the legacy key */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = serverKey();
    if (!url || !serviceKey) return json({ error: 'The function is missing its Supabase settings (no secret key).' }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Who is calling? Must be a logged-in admin.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return json({ error: 'Please log in again.' }, 401);
    const { data: me, error: meErr } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle();
    if (meErr) return json({ error: 'Couldn’t check your role: ' + meErr.message }, 500);
    if (!me) return json({ error: 'Couldn’t find your profile. Log out and back in, then try again.' }, 403);
    if (me.role !== 'admin') return json({ error: 'Only admins can manage users.' }, 403);

    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case 'list': {
        const users: unknown[] = [];
        for (let page = 1; page < 50; page++) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) return json({ error: error.message }, 400);
          users.push(...data.users.map((u) => ({
            id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
            confirmed: !!(u.email_confirmed_at || u.confirmed_at), invited: !!u.invited_at && !u.last_sign_in_at,
          })));
          if (data.users.length < 1000) break;
        }
        return json({ users });
      }
      case 'create': {
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim();
        const role = ROLES.includes(body.role) ? body.role : 'exhibitor';
        if (!name || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Enter a name and a valid email address.' }, 400);
        let user;
        if (body.mode === 'invite') {
          const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
            data: { display_name: name }, redirectTo: body.redirectTo || undefined,
          });
          if (error) return json({ error: error.message }, 400);
          user = data.user;
        } else {
          const password = String(body.password || '');
          if (password.length < 8) return json({ error: 'The temporary password needs at least 8 characters.' }, 400);
          const { data, error } = await admin.auth.admin.createUser({
            email, password, email_confirm: true, user_metadata: { display_name: name },
          });
          if (error) return json({ error: error.message }, 400);
          user = data.user;
        }
        // The sign-up trigger creates the profile; set the chosen name and role on it.
        const { error: pErr } = await admin.from('profiles').upsert({ id: user.id, display_name: name, role });
        if (pErr) return json({ error: 'Account created, but setting the role failed: ' + pErr.message }, 500);
        return json({ user: { id: user.id, email, name, role } });
      }
      case 'setPassword': {
        const password = String(body.password || '');
        if (!body.id || password.length < 8) return json({ error: 'The new password needs at least 8 characters.' }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.id, { password });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case 'delete': {
        if (!body.id) return json({ error: 'Missing user.' }, 400);
        if (body.id === who.user.id) return json({ error: 'You can’t remove your own account here.' }, 400);
        const { error } = await admin.auth.admin.deleteUser(body.id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      default:
        return json({ error: 'Unknown action.' }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
