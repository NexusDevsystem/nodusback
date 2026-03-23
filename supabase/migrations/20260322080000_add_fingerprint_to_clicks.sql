-- Migration: Add fingerprint to clicks table for unique visitor tracking
ALTER TABLE public.clicks
    ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- Index for faster unique counting
CREATE INDEX IF NOT EXISTS idx_clicks_fingerprint ON public.clicks(fingerprint);
CREATE INDEX IF NOT EXISTS idx_clicks_type_fingerprint ON public.clicks(type, fingerprint);

NOTIFY pgrst, 'reload schema';
