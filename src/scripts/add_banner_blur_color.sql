-- Migration: Add banner_blur_color to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_blur_color TEXT;
