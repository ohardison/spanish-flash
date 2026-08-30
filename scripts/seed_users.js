// scripts/seed_users.js
// Usage: SUPABASE_URL=https://<proj>.supabase.co SERVICE_ROLE_KEY=<service_role_key> node scripts/seed_users.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const fetch = global.fetch || require('node-fetch');

async function createUser(email, password) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create user ${email}: ${res.status} ${text}`);
  }
  return res.json();
}

async function insertAdmin(userId) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/admins`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify([{ user_id: userId }])
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to insert admin row: ${res.status} ${text}`);
  }
  return res.json();
}

(async () => {
  try {
    console.log('Creating demo user: user99@example.com');
    const demo = await createUser('user99@example.com', 'flash@Pass!23?');
    console.log('Demo user created:', demo.id, demo.email);

    console.log('Creating superuser: hardisun@gmail.com');
    const admin = await createUser('hardisun@gmail.com', 'SuperSecure!23');
    console.log('Superuser created:', admin.id, admin.email);

    console.log('Inserting admin row in public.admins');
    const inserted = await insertAdmin(admin.id);
    console.log('Inserted admin row:', inserted);

    console.log('\nDONE. Please do not commit your SERVICE_ROLE_KEY anywhere.\n');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
