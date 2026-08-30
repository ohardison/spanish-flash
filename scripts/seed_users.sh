#!/usr/bin/env bash
# helper shell script showing curl commands to seed users (do not run in CI without protecting SERVICE_ROLE_KEY)
# Usage example:
# SUPABASE_URL=https://<proj>.supabase.co SERVICE_ROLE_KEY=<service_role_key> ./scripts/seed_users.sh

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "Please set SUPABASE_URL and SERVICE_ROLE_KEY environment variables before running."
  exit 1
fi

# Create demo user
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"user99@example.com","password":"flash@Pass!23?","email_confirm":true}'

# Create superuser
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"hardisun@gmail.com","password":"SuperSecure!23","email_confirm":true}'

# After creating the superuser, take the returned user's id and insert into public.admins via PostgREST:
# curl -s -X POST "$SUPABASE_URL/rest/v1/admins" \
#   -H "apikey: $SERVICE_ROLE_KEY" \
#   -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
#   -H "Content-Type: application/json" \
#   -d '[{"user_id":"<INSERT_USER_ID_HERE>"}]'

echo "Seed commands executed (check outputs above)."
