-- Add provider_account_id to social_integrations to support multiple accounts per provider
ALTER TABLE public.social_integrations
ADD COLUMN IF NOT EXISTS provider_account_id text;

-- Drop the old unique constraint (user_id + provider)
ALTER TABLE public.social_integrations
DROP CONSTRAINT IF EXISTS social_integrations_user_id_provider_key;

-- Since provider_account_id might be null for existing records, we need a unique constraint
-- that includes it. PostgreSQL treats NULLs as distinct in unique constraints,
-- but we want to ensure uniqueness.
-- We can add a unique constraint on (user_id, provider, provider_account_id)
ALTER TABLE public.social_integrations
ADD CONSTRAINT social_integrations_user_id_provider_account_id_key UNIQUE (user_id, provider, provider_account_id);
