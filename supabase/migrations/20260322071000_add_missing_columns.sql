-- Migration: Add missing columns to stores and products tables
-- Fixes PGRST204 errors: 'disabled_collections' and 'is_active' not found in schema cache

-- 1. Add 'disabled_collections' column to 'stores' table (if not exists)
ALTER TABLE public.stores
    ADD COLUMN IF NOT EXISTS disabled_collections TEXT[] DEFAULT '{}';

-- 2. Add 'is_active' column to 'products' table (if not exists)
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;

-- 3. Reload PostgREST schema cache (Supabase does this automatically on next request,
--    but we can notify it explicitly)
NOTIFY pgrst, 'reload schema';
