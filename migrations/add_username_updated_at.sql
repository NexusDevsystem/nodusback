-- Migration: Add username_updated_at to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_updated_at TIMESTAMP WITH TIME ZONE;
