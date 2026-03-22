-- Create stores table
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    position INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add store_id to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Dynamic RLS Policies
DROP POLICY IF EXISTS "Users can view their own stores" ON public.stores;
CREATE POLICY "Users can view their own stores" ON public.stores
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own stores" ON public.stores;
CREATE POLICY "Users can insert their own stores" ON public.stores
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own stores" ON public.stores;
CREATE POLICY "Users can update their own stores" ON public.stores
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own stores" ON public.stores;
CREATE POLICY "Users can delete their own stores" ON public.stores
    FOR DELETE USING (auth.uid() = user_id);

-- Public access to stores (for public profile)
DROP POLICY IF EXISTS "Anyone can view active stores" ON public.stores;
CREATE POLICY "Anyone can view active stores" ON public.stores
    FOR SELECT USING (is_active = true);
