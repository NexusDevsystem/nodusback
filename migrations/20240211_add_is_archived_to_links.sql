-- Add is_archived column to links table if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='links' AND column_name='is_archived') THEN 
        ALTER TABLE links ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
