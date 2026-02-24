-- Migration: Add missing design customization columns to users table
-- Run this script in the Supabase SQL Editor

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS custom_secondary_color TEXT,
ADD COLUMN IF NOT EXISTS custom_button_text_color TEXT,
ADD COLUMN IF NOT EXISTS custom_collection_text_color TEXT,
ADD COLUMN IF NOT EXISTS font_weight TEXT DEFAULT '400',
ADD COLUMN IF NOT EXISTS font_italic BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS font_size INTEGER DEFAULT 16,
ADD COLUMN IF NOT EXISTS enable_blur BOOLEAN DEFAULT true;

-- Update existing records if necessary
UPDATE public.users SET font_weight = '400' WHERE font_weight IS NULL;
UPDATE public.users SET font_italic = false WHERE font_italic IS NULL;
UPDATE public.users SET font_size = 16 WHERE font_size IS NULL;
UPDATE public.users SET enable_blur = true WHERE enable_blur IS NULL;
