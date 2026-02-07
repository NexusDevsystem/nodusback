import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Client } = pg;

async function executeSchema() {
    console.log('🚀 Executando schema SQL no Supabase...\n');

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('✅ Conectado ao Supabase\n');

        // Ler o arquivo SQL
        const schemaPath = join(__dirname, '../../supabase-schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');

        console.log('📄 Executando schema SQL...');
        console.log(`   Tamanho: ${(schema.length / 1024).toFixed(2)} KB\n`);

        // Executar o schema completo
        await client.query(schema);

        console.log('✅ Schema executado com sucesso!\n');

        // Verificar tabelas criadas
        console.log('🔍 Verificando tabelas criadas...');

        const result = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);

        console.log(`\n📊 Tabelas criadas (${result.rows.length}):`);
        result.rows.forEach(row => {
            console.log(`   ✅ ${row.table_name}`);
        });

        console.log(`\n🎉 Setup do banco de dados concluído!`);
        console.log(`\n📝 Próximo passo: Execute o script de migração`);
        console.log(`   npx tsx src/scripts/migrate-data.ts\n`);

    } catch (error) {
        console.error('❌ Erro ao executar schema:', error.message);
        if (error.position) {
            console.error(`   Posição do erro: ${error.position}`);
        }
        process.exit(1);
    } finally {
        await client.end();
    }
}

executeSchema();
