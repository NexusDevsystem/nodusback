-- Add collections to stores
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS collections TEXT[] DEFAULT '{}';
