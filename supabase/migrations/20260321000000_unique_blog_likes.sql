-- Create blog_post_likes table to track unique likes
CREATE TABLE IF NOT EXISTS public.blog_post_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, fingerprint)
);

-- Enable RLS
ALTER TABLE public.blog_post_likes ENABLE ROW LEVEL SECURITY;

-- Allow public to insert (anyone can like anonymously)
DROP POLICY IF EXISTS "Public can like posts" ON public.blog_post_likes;
CREATE POLICY "Public can like posts" ON public.blog_post_likes
    FOR INSERT WITH CHECK (true);

-- Allow public to see if they liked a post
DROP POLICY IF EXISTS "Public can check likes" ON public.blog_post_likes;
CREATE POLICY "Public can check likes" ON public.blog_post_likes
    FOR SELECT USING (true);

-- Create a function to handle likes_count update
CREATE OR REPLACE FUNCTION public.handle_blog_post_like()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.blog_posts
    SET likes_count = likes_count + 1
    WHERE id = NEW.post_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger
DROP TRIGGER IF EXISTS tr_blog_post_like_added ON public.blog_post_likes;
CREATE TRIGGER tr_blog_post_like_added
    AFTER INSERT ON public.blog_post_likes
    FOR EACH ROW EXECUTE FUNCTION public.handle_blog_post_like();
