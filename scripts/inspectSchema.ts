
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function verify() {
    const logBuffer: string[] = [];
    const log = (msg: string) => {
        console.log(msg);
        logBuffer.push(msg);
    };

    log('Verifying links table columns...');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const client = await pool.connect();

    try {
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'links'
            ORDER BY ordinal_position;
        `);

        log('Columns in "links" table:');
        const columns = res.rows.map(r => r.column_name);
        res.rows.forEach(row => {
            log(`- ${row.column_name} (${row.data_type})`);
        });

        const expected = ['schedule_start', 'schedule_end', 'platform', 'position', 'is_archived', 'subtitle', 'embed_type', 'highlight', 'type', 'layout', 'clicks', 'is_active', 'icon', 'url', 'title', 'parent_id', 'user_id'];

        const missing = expected.filter(col => !columns.includes(col));

        if (missing.length > 0) {
            log(`❌ MISSING COLUMNS: ${missing.join(', ')}`);
        } else {
            log('✅ ALL EXPECTED COLUMNS PRESENT (including schedule_start/end).');
        }

    } catch (err) {
        log(`Error: ${err}`);
    } finally {
        client.release();
        await pool.end();
        fs.writeFileSync('schema_check.txt', logBuffer.join('\n'));
    }
}

verify();
