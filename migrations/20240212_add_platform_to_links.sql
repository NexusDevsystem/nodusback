-- Add platform column to links table
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='links' AND column_name='platform') THEN 
        ALTER TABLE links ADD COLUMN platform TEXT;
    END IF;
END $$;
