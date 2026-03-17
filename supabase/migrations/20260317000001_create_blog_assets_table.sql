-- Create blog_assets table to track all uploaded media for the editorial system
CREATE TABLE IF NOT EXISTS public.blog_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    url TEXT NOT NULL,
    mimetype TEXT,
    size INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.blog_assets ENABLE ROW LEVEL SECURITY;

-- Policy: Superadmins can manage assets
CREATE POLICY "Superadmins can manage assets" ON public.blog_assets
    USING (auth.jwt() ->> 'role' = 'superadmin')
    WITH CHECK (auth.jwt() ->> 'role' = 'superadmin');

-- Policy: Backend (service_role) has full access
CREATE POLICY "Service role has full access to assets" ON public.blog_assets
    USING (true)
    WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_blog_assets_user_id ON public.blog_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_blog_assets_created_at ON public.blog_assets(created_at DESC);
