-- =============================================================
-- NODUS: Supabase Security Advisor Fixes
-- Run this script in the Supabase SQL Editor
-- =============================================================

-- =============================================
-- 1. ENABLE RLS ON ALL TABLES (5 errors)
-- Note: Backend uses SUPABASE_SERVICE_ROLE_KEY 
-- which ALWAYS bypasses RLS, so this is safe.
-- =============================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_integrations ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 2. FIX RLS POLICY "ALWAYS TRUE" ON links
-- Drop the old permissive policy and create 
-- a proper one that allows public READ only.
-- =============================================

-- Drop any existing overly permissive policies on links
DROP POLICY IF EXISTS "Allow all" ON public.links;
DROP POLICY IF EXISTS "allow_all" ON public.links;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.links;

-- Allow anyone to READ links (public profiles need this)
CREATE POLICY "public_read_links"
ON public.links FOR SELECT
USING (true);

-- Only service_role can INSERT/UPDATE/DELETE (already bypasses RLS)
-- No additional policies needed since backend uses service_role key.

-- =============================================
-- 3. CREATE RLS POLICIES FOR OTHER TABLES
-- (Allow public read where needed)
-- =============================================

-- Users: allow public READ (for public profiles)
CREATE POLICY "public_read_users"
ON public.users FOR SELECT
USING (true);

-- Products: allow public READ (for public shop pages)
CREATE POLICY "public_read_products"
ON public.products FOR SELECT
USING (true);

-- Clicks: NO public access needed (only backend writes/reads)
-- Service role bypasses RLS, so no policy needed.

-- Leads: NO public access needed (only backend writes/reads)
-- But we need INSERT for public lead capture forms
CREATE POLICY "public_insert_leads"
ON public.leads FOR INSERT
WITH CHECK (true);

-- Social Integrations: NO public access (sensitive data)
-- Service role bypasses RLS, so no policy needed.

-- =============================================
-- 4. REVOKE DIRECT ACCESS TO SENSITIVE COLUMNS
-- on social_integrations (access_token, etc.)
-- =============================================

-- Revoke SELECT on sensitive columns from anon and authenticated roles
-- This prevents anyone from reading tokens through PostgREST directly
REVOKE SELECT ON public.social_integrations FROM anon;
REVOKE SELECT ON public.social_integrations FROM authenticated;

-- If you need to grant back non-sensitive columns later:
-- GRANT SELECT (id, user_id, provider, username, channel_id, created_at) 
-- ON public.social_integrations TO authenticated;

-- =============================================
-- 5. FIX FUNCTION SEARCH PATH (3 warnings)
-- Set search_path to prevent search path injection
-- =============================================

-- Fix update_links_updated_at
ALTER FUNCTION public.update_links_updated_at() SET search_path = public;

-- Fix update_timestamp  
ALTER FUNCTION public.update_timestamp() SET search_path = public;

-- Fix handle_updated_at
ALTER FUNCTION public.handle_updated_at() SET search_path = public;

-- =============================================
-- 6. ENABLE LEAKED PASSWORD PROTECTION
-- =============================================

-- This needs to be done via the Supabase Dashboard:
-- Go to: Authentication > Settings > Security
-- Enable "Leaked Password Protection"
-- (Cannot be done via SQL)

-- =============================================
-- VERIFICATION: Check that everything is correct
-- =============================================

-- Verify RLS is enabled on all tables
SELECT 
    schemaname, 
    tablename, 
    rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('users', 'links', 'products', 'clicks', 'leads', 'social_integrations');
