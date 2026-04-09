-- Table to track which users have seen which announcements
CREATE TABLE announcement_views (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
    seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, announcement_id)
);

-- Enable RLS
ALTER TABLE announcement_views ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see their own views
CREATE POLICY "Users can view their own announcement views" ON announcement_views
    FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own views
CREATE POLICY "Users can insert their own announcement views" ON announcement_views
    FOR INSERT WITH CHECK (auth.uid() = user_id);
