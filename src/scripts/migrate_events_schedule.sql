-- Migration to add schedule columns to events table
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS schedule_start TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS schedule_end TIMESTAMP WITH TIME ZONE;
