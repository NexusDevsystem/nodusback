-- Add views_count to blog_posts
ALTER TABLE public.blog_posts ADD COLUMN IF NOT EXISTS views_count INTEGER DEFAULT 0;
