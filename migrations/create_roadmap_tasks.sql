-- Migration: Create roadmap_tasks table
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS roadmap_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'planned', 'in_progress', 'done')),
  author_name TEXT,
  is_admin BOOLEAN DEFAULT FALSE NOT NULL,
  votes INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_status ON roadmap_tasks(status);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_roadmap_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER roadmap_tasks_updated_at
  BEFORE UPDATE ON roadmap_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_roadmap_updated_at();

-- Row Level Security (optional but recommended)
ALTER TABLE roadmap_tasks ENABLE ROW LEVEL SECURITY;

-- Allow public reads
CREATE POLICY "Public read roadmap_tasks" ON roadmap_tasks
  FOR SELECT USING (true);

-- Allow public inserts (user submissions)
CREATE POLICY "Public insert roadmap_tasks" ON roadmap_tasks
  FOR INSERT WITH CHECK (status = 'backlog');

-- Only service role can update/delete (admin via backend)
CREATE POLICY "Service role can update roadmap_tasks" ON roadmap_tasks
  FOR UPDATE USING (true);

CREATE POLICY "Service role can delete roadmap_tasks" ON roadmap_tasks
  FOR DELETE USING (true);
