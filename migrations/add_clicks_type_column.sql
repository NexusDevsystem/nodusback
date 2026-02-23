-- =============================================
-- NODUS: Add 'type' column to clicks table
-- Run this script in the Supabase SQL Editor
-- Fixes: PGRST204 "Could not find the 'type' column of 'clicks' in the schema cache"
-- =============================================

-- 1. Add the 'type' column (TEXT, defaults to 'click' for existing rows)
ALTER TABLE public.clicks
ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'click';

-- 2. Backfill existing rows that don't have a type yet
UPDATE public.clicks SET type = 'click' WHERE type IS NULL OR type = '';

-- 3. Add an index for efficient filtering by type (used in analytics queries)
CREATE INDEX IF NOT EXISTS idx_clicks_type ON public.clicks(type);
CREATE INDEX IF NOT EXISTS idx_clicks_user_type ON public.clicks(user_id, type);

-- 4. Force PostgREST to reload its schema cache (important!)
-- Run this AFTER the above statements:
NOTIFY pgrst, 'reload schema';

-- 5. Verification: check columns exist
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'clicks'
ORDER BY ordinal_position;
