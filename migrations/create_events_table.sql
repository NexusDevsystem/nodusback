-- Create events table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    location TEXT,
    url TEXT,
    status TEXT DEFAULT 'Tickets', -- e.g., 'Tickets', 'Sold Out', 'Free'
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_events_collection_id ON events(collection_id);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
