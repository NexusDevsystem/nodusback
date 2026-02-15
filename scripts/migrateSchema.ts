
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from one level up (backend root)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function migrate() {
    const logBuffer: string[] = [];
    const log = (msg: string) => {
        console.log(msg);
        logBuffer.push(msg);
    };

    log('Starting migration...');

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        log('DATABASE_URL not found in environment variables');
        fs.writeFileSync('migration_log.txt', logBuffer.join('\n'));
        process.exit(1);
    }

    try {
        const pool = new Pool({
            connectionString,
            ssl: { rejectUnauthorized: false } // Required for Supabase
        });

        log('Connecting to database...');
        const client = await pool.connect();
        log('Connected to database.');

        const query = `
            ALTER TABLE links
            ADD COLUMN IF NOT EXISTS schedule_start TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS schedule_end TIMESTAMPTZ;
        `;

        await client.query(query);
        log('✅ Migration successful: Added schedule_start and schedule_end columns.');

        client.release();
        await pool.end();
    } catch (err: any) {
        log(`❌ Migration failed: ${err.message}`);
        log(err.stack);
    } finally {
        fs.writeFileSync('migration_log.txt', logBuffer.join('\n'));
    }
}

migrate();
