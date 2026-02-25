-- Migration to add time column to events table
ALTER TABLE events ADD COLUMN time TEXT;
