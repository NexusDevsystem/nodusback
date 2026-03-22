-- Migration to Enable Row Level Security (RLS) on all tables for Nodus
-- This version handles both missing tables and missing columns gracefully.

DO $$ 
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN (
            'users', 
            'links', 
            'products', 
            'clicks', 
            'blog_posts', 
            'blog_assets', 
            'social_integrations', 
            'auth_otps', 
            'stores',
            'blog_post_likes'
        )
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- Helper function to check if a column exists
CREATE OR REPLACE FUNCTION public.check_column_exists(t_name text, c_name text) 
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = t_name 
        AND column_name = c_name
    );
END;
$$ LANGUAGE plpgsql;

-- 1. USERS POLICIES
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.users;
CREATE POLICY "Public profiles are viewable by everyone" ON public.users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid()::text = id::text);

-- 2. LINKS POLICIES
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'links') THEN
        DROP POLICY IF EXISTS "Active links are viewable by everyone" ON public.links;
        IF public.check_column_exists('links', 'is_active') THEN
            CREATE POLICY "Active links are viewable by everyone" ON public.links FOR SELECT USING (is_active = true OR auth.uid()::text = user_id::text);
        ELSE
            CREATE POLICY "Active links are viewable by everyone" ON public.links FOR SELECT USING (auth.uid()::text = user_id::text);
        END IF;

        DROP POLICY IF EXISTS "Users can manage own links" ON public.links;
        CREATE POLICY "Users can manage own links" ON public.links FOR ALL USING (auth.uid()::text = user_id::text);
    END IF;
END $$;

-- 3. PRODUCTS POLICIES
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        DROP POLICY IF EXISTS "Active products are viewable by everyone" ON public.products;
        IF public.check_column_exists('products', 'is_active') THEN
            CREATE POLICY "Active products are viewable by everyone" ON public.products FOR SELECT USING (is_active = true OR auth.uid()::text = user_id::text);
        ELSE
            CREATE POLICY "Active products are viewable by everyone" ON public.products FOR SELECT USING (auth.uid()::text = user_id::text);
        END IF;

        DROP POLICY IF EXISTS "Users can manage own products" ON public.products;
        CREATE POLICY "Users can manage own products" ON public.products FOR ALL USING (auth.uid()::text = user_id::text);
    END IF;
END $$;

-- 4. BLOG ASSETS POLICIES
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'blog_assets') THEN
        DROP POLICY IF EXISTS "Blog assets are viewable by everyone" ON public.blog_assets;
        CREATE POLICY "Blog assets are viewable by everyone" ON public.blog_assets FOR SELECT USING (true);

        DROP POLICY IF EXISTS "Users can manage own blog assets" ON public.blog_assets;
        CREATE POLICY "Users can manage own blog assets" ON public.blog_assets FOR ALL USING (auth.uid()::text = user_id::text);
    END IF;
END $$;

-- 5. CLICKS / ANALYTICS POLICIES
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clicks') THEN
        DROP POLICY IF EXISTS "Everyone can insert clicks" ON public.clicks;
        CREATE POLICY "Everyone can insert clicks" ON public.clicks FOR INSERT WITH CHECK (true);

        DROP POLICY IF EXISTS "Users can view own clicks" ON public.clicks;
        CREATE POLICY "Users can view own clicks" ON public.clicks FOR SELECT USING (auth.uid()::text = user_id::text);
    END IF;
END $$;

-- 6. SOCIAL INTEGRATIONS
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'social_integrations') THEN
        DROP POLICY IF EXISTS "Users can manage own integrations" ON public.social_integrations;
        CREATE POLICY "Users can manage own integrations" ON public.social_integrations FOR ALL USING (auth.uid()::text = user_id::text);
    END IF;
END $$;

-- 7. STORES POLICIES
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stores') THEN
        DROP POLICY IF EXISTS "Public stores are viewable by everyone" ON public.stores;
        CREATE POLICY "Public stores are viewable by everyone" ON public.stores FOR SELECT USING (true);

        DROP POLICY IF EXISTS "Users can manage own stores" ON public.stores;
        CREATE POLICY "Users can manage own stores" ON public.stores FOR ALL USING (auth.uid()::text = user_id::text);
    END IF;
END $$;

-- 8. BLOG POSTS
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'blog_posts') THEN
        DROP POLICY IF EXISTS "Public can view published posts" ON public.blog_posts;
        IF public.check_column_exists('blog_posts', 'is_published') THEN
            CREATE POLICY "Public can view published posts" ON public.blog_posts FOR SELECT USING (is_published = true OR auth.uid() IS NOT NULL);
        ELSE
            CREATE POLICY "Public can view published posts" ON public.blog_posts FOR SELECT USING (auth.uid() IS NOT NULL);
        END IF;
    END IF;
END $$;

-- CLEAN UP HELPER
DROP FUNCTION public.check_column_exists(text, text);
