-- Migration: Add email/password auth support
-- Run this in your Supabase SQL Editor

-- 1. Add password_hash column (nullable - Google users won't have one)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Add auth_provider column to distinguish login methods
ALTER TABLE users
ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'google';

-- 3. Update existing users to be marked as Google users
UPDATE users
SET auth_provider = 'google'
WHERE auth_provider IS NULL;

-- Verification queries (optional):
-- SELECT id, email, auth_provider, CASE WHEN password_hash IS NOT NULL THEN 'has_password' ELSE 'no_password' END as pwd_status FROM users LIMIT 10;
