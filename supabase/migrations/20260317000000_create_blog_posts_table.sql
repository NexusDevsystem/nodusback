-- Create blog_posts table for the editorial blog system
CREATE TABLE IF NOT EXISTS public.blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT,
    content TEXT,
    image_url TEXT,
    category TEXT DEFAULT 'Novidades',
    author TEXT,
    color TEXT,
    is_published BOOLEAN DEFAULT FALSE,
    likes_count INTEGER DEFAULT 0,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

-- Policy: Public access for published posts
DROP POLICY IF EXISTS "Public can view published posts" ON public.blog_posts;
CREATE POLICY "Public can view published posts" ON public.blog_posts
    FOR SELECT USING (is_published = true);

-- Policy: Full access for service_role (backend)
-- (Implicit if not using RLS for specific roles, but good to have)
DROP POLICY IF EXISTS "Service role has full access" ON public.blog_posts;
CREATE POLICY "Service role has full access" ON public.blog_posts
    USING (true)
    WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON public.blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_is_published ON public.blog_posts(is_published);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON public.blog_posts(published_at DESC);
