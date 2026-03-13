-- Add hide_branding column to users table to support hiding Nodus branding
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS hide_branding BOOLEAN DEFAULT FALSE;
