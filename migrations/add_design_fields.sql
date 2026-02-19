-- =============================================
-- NODUS: Add Design and SEO Columns to Users Table
-- Run this script in the Supabase SQL Editor
-- =============================================

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS header_layout TEXT DEFAULT 'classic',
ADD COLUMN IF NOT EXISTS header_style TEXT DEFAULT 'text',
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS avatar_size TEXT DEFAULT 'md',
ADD COLUMN IF NOT EXISTS custom_css TEXT,
ADD COLUMN IF NOT EXISTS seo_title TEXT,
ADD COLUMN IF NOT EXISTS seo_description TEXT,
ADD COLUMN IF NOT EXISTS payment_methods JSONB DEFAULT '[]'::jsonb;

-- Update existing records with defaults if necessary
UPDATE public.users SET header_layout = 'classic' WHERE header_layout IS NULL;
UPDATE public.users SET header_style = 'text' WHERE header_style IS NULL;
UPDATE public.users SET avatar_size = 'md' WHERE avatar_size IS NULL;
UPDATE public.users SET payment_methods = '[]'::jsonb WHERE payment_methods IS NULL;
