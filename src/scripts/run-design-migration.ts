import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { Client } = pg;

async function runMigration() {
    console.log('🚀 Iniciando atualização das colunas de design no Supabase...\n');

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('✅ Conectado ao banco de dados\n');

        const migrationPath = join(__dirname, '../../migrations/update_missing_design_columns.sql');
        const sql = readFileSync(migrationPath, 'utf-8');

        console.log('📝 Executando SQL de migração...');
        await client.query(sql);

        console.log('✨ Colunas atualizadas com sucesso!\n');
    } catch (error: any) {
        console.error('❌ Erro ao executar migração:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runMigration();
