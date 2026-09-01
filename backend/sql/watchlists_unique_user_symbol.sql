-- Apply once in the Supabase SQL editor after confirming there are no existing
-- duplicate (user_id, symbol) rows. This migration does not delete or rewrite data;
-- PostgreSQL will stop with an error if duplicates must be resolved first.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watchlists_user_symbol_key'
      AND conrelid = 'public.watchlists'::regclass
  ) THEN
    ALTER TABLE public.watchlists
      ADD CONSTRAINT watchlists_user_symbol_key UNIQUE (user_id, symbol);
  END IF;
END
$$;
