import { supabase } from '../src/config/supabaseClient.js';
import { connectMongo } from '../src/config/mongoClient.js';
import {
    UserModel,
    LinkModel,
    ProductModel,
    StoreModel,
    EventModel,
    LeadModel,
    ClickModel,
    SocialIntegrationModel,
    BlogPostModel,
    BlogPostLikeModel,
    AuthOtpModel,
    RoadmapTaskModel,
    AnnouncementModel,
    AnnouncementViewModel,
    VerificationRequestModel
} from '../src/models/mongoModels.js';
import mongoose from 'mongoose';

interface MigrationTarget {
    tableName: string;
    model: mongoose.Model<any>;
    idField?: string;
}

const targets: MigrationTarget[] = [
    { tableName: 'users', model: UserModel },
    { tableName: 'links', model: LinkModel },
    { tableName: 'products', model: ProductModel },
    { tableName: 'stores', model: StoreModel },
    { tableName: 'events', model: EventModel },
    { tableName: 'leads', model: LeadModel },
    { tableName: 'clicks', model: ClickModel },
    { tableName: 'social_integrations', model: SocialIntegrationModel },
    { tableName: 'blog_posts', model: BlogPostModel },
    { tableName: 'blog_post_likes', model: BlogPostLikeModel },
    { tableName: 'auth_otps', model: AuthOtpModel },
    { tableName: 'roadmap_tasks', model: RoadmapTaskModel },
    { tableName: 'announcements', model: AnnouncementModel },
    { tableName: 'announcement_views', model: AnnouncementViewModel, idField: 'user_id_announcement_id' },
    { tableName: 'verification_requests', model: VerificationRequestModel },
];

async function migrateTable(target: MigrationTarget) {
    const { tableName, model, idField } = target;
    console.log(`\n==================================================`);
    console.log(`🚀 Iniciando migração da tabela: [${tableName}]...`);

    // Obter contagem total no Supabase
    const { count: totalRecords, error: countErr } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

    if (countErr) {
        console.warn(`⚠️ Não foi possível obter contagem de [${tableName}]: ${countErr.message}`);
    }

    const total = totalRecords || 0;
    console.log(`📊 Total de registros no Supabase: ${total}`);

    if (total === 0) {
        console.log(`ℹ️ Tabela [${tableName}] está vazia. Pulando.`);
        return { tableName, migrated: 0, total: 0 };
    }

    const BATCH_SIZE = 500;
    let offset = 0;
    let totalMigrated = 0;

    while (offset < total) {
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
            console.error(`❌ Erro ao buscar lote de [${tableName}] no offset ${offset}:`, error);
            throw error;
        }

        if (!data || data.length === 0) break;

        const operations = data.map((item: any) => {
            const doc: any = { ...item };

            // Trata _id e id
            if (idField === 'user_id_announcement_id') {
                doc._id = `${item.user_id}_${item.announcement_id}`;
            } else if (item.id) {
                doc._id = String(item.id);
                doc.id = String(item.id);
            }

            return {
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: doc },
                    upsert: true
                }
            };
        });

        const result = await model.bulkWrite(operations, { ordered: false });
        const batchMigrated = (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);
        totalMigrated += data.length;
        offset += data.length;

        console.log(`   ⏳ [${tableName}] Migrados ${totalMigrated}/${total} registros...`);
    }

    const mongoCount = await model.countDocuments();
    console.log(`✅ [${tableName}] Concluído! Total no MongoDB Atlas: ${mongoCount}`);
    return { tableName, migrated: totalMigrated, total, mongoCount };
}

async function runMigration() {
    console.log(`🌟 Iniciando processo de migração completa: Supabase -> MongoDB Atlas`);
    console.log(`Data e hora: ${new Date().toISOString()}`);

    try {
        await connectMongo();

        const results = [];
        for (const target of targets) {
            const res = await migrateTable(target);
            results.push(res);
        }

        console.log(`\n==================================================`);
        console.log(`🎉 MIGRAÇÃO CONCLUÍDA COM SUCESSO! RESUMO:`);
        console.log(`==================================================`);
        console.table(results);

        process.exit(0);
    } catch (err) {
        console.error(`❌ FALHA CRÍTICA NA MIGRAÇÃO:`, err);
        process.exit(1);
    }
}

runMigration();
