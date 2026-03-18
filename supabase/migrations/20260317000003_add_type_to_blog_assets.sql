-- Add asset_type to blog_assets to distinguish between different systems
-- blog: images used in blog posts
-- user_upload: files uploaded manually by the user in the "Files" area
-- thumbnail: system generated thumbnails
ALTER TABLE public.blog_assets ADD COLUMN IF NOT EXISTS asset_type TEXT DEFAULT 'user_upload';

-- Update existing records if any
UPDATE public.blog_assets SET asset_type = 'blog' WHERE asset_type IS NULL;
