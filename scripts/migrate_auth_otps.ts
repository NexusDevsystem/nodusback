import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '../migrations/create_auth_otps.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const { Client } = pg;
const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    await client.connect();
    console.log('Connected to DB');
    try {
        await client.query(sql);
        console.log('Migration create_auth_otps executed successfully.');
    } catch (error) {
        console.error('Error executing migration:', error);
    } finally {
        await client.end();
    }
}

run();
