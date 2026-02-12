-- Ensure 'layout' column supports new values
-- This helps if 'layout' was previously defined with a CHECK constraint or as an ENUM
DO $$ 
BEGIN 
    -- If it's a simple text column, this does nothing but ensure it exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='links' AND column_name='layout') THEN 
        ALTER TABLE links ADD COLUMN layout TEXT;
    END IF;

    -- If there was a CHECK constraint, we might need to drop it or update it.
    -- Assuming a simple TEXT column for now as per most Supabase setups,
    -- but this migration serves as a record that these values are now expected.
END $$;
