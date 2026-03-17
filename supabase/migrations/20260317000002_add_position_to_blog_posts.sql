-- Add position column to blog_posts for manual ordering
ALTER TABLE public.blog_posts ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;

-- Update existing posts to have a position based on their creation date
WITH numbered_posts AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) - 1 as new_position
    FROM public.blog_posts
)
UPDATE public.blog_posts
SET position = numbered_posts.new_position
FROM numbered_posts
WHERE public.blog_posts.id = numbered_posts.id;
