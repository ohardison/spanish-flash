Spanish Flash — English/Spanish Flashcards

Quick start

1. Install dependencies
   npm install

2. Create a local .env
   - Copy the example (no secrets committed):
     cp create_env.example .env
   - Edit .env and set the following values:
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_ANON_KEY=your-anon-public-key
     (Optional) DEFAULT_USER / DEFAULT_PASS for legacy local login

3. Create the flashcards table in Supabase
   - Open your Supabase project → SQL Editor and run the SQL in create_flashcards_table.sql
   - That creates the public.flashcards table and RLS policies for per-user access.

4. Run the app
   npm start
   Open http://localhost:3000

Usage

- Sign up / Sign in using email + password (Supabase Auth). After sign-in, use Edit Mode to add flashcards and Practice Mode to quiz.
- When Supabase isn’t configured the app falls back to localStorage (key: myFlashcards).

Security notes

- Do NOT commit .env or any API keys. .env is ignored by .gitignore.
- Use the Supabase anon (public) key in the browser. Never expose your service_role key in client-side code.

Dev & deployment

- Files of interest: server.js (serves config), script.js (client + Supabase logic), index.html, style.css.
- To deploy: build a static host or server host (e.g., Vercel). Set SUPABASE_URL and SUPABASE_ANON_KEY as environment variables in the host.

Troubleshooting

- If you see 401/Unauthorized from Supabase, verify SUPABASE_ANON_KEY matches the project anon key and that "Enable sign-ups" is turned on in Supabase Auth settings.
- If the flashcards REST calls return 404 or PGRST205, ensure create_flashcards_table.sql has been executed and RLS is enabled.

If you'd like, I can also add automated migration scripts (Supabase CLI) or a CSV import/export feature.
