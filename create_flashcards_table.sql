-- Create flashcards table for Supabase
-- Run this in the Supabase SQL editor or psql connected to your project's DB

CREATE TABLE IF NOT EXISTS public.flashcards (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  english text NOT NULL,
  spanish text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS and create a policy so users can operate only on their rows
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their flashcards" ON public.flashcards
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Note: when inserting from the client, set user_id = auth.uid() (supabase client can read the current user's id)
