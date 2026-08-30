-- create_admins_and_policies.sql
-- Run this in the Supabase SQL editor (or via psql with the service_role key)

-- 1) Admins table to record user UUIDs that are superusers
CREATE TABLE IF NOT EXISTS public.admins (
  user_id uuid PRIMARY KEY,
  created_at timestamptz DEFAULT now()
);

-- 2) Ensure RLS is enabled on flashcards (if not already)
ALTER TABLE IF EXISTS public.flashcards ENABLE ROW LEVEL SECURITY;

-- 3) Policy: allow owners or admins to manage flashcards
-- This policy allows authenticated users to act on their own rows OR users
-- listed in public.admins to act on any row.
CREATE POLICY IF NOT EXISTS "owners_or_admins_manage_flashcards" ON public.flashcards
  FOR ALL
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()
    )
  );

-- Note: If you already have owner-only policies, they can remain; this policy
-- will allow admins (entries in public.admins) the same access. Run in SQL editor.
