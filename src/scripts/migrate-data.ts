import { supabase } from '../config/supabaseClient.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface OldLink {
    id: string;
    title: string;
    url: string;
    image?: string;
    isActive: boolean;
    clicks?: number;
    layout?: string;
    type?: string;
    children?: OldLink[];
    highlight?: string;
    embedType?: string;
}

interface OldProduct {
    id: string;
    name: string;
    price?: string;
    image: string;
    url: string;
    discountCode?: string;
}

interface OldAnalyticsEvent {
    linkId: string;
    timestamp: string;
    type: string;
}

interface OldNewsletterLead {
    id: string;
    email: string;
    name?: string;
    timestamp: string;
}

interface OldDatabase {
    profile: any;
    links: OldLink[];
    products: OldProduct[];
    analytics: OldAnalyticsEvent[];
    leads: OldNewsletterLead[];
}

async function migrateData() {
    console.log('🚀 Iniciando migração de dados...\n');

    try {
        // 1. Ler db.json
        const dbPath = join(__dirname, '../../data/db.json');
        const data: OldDatabase = JSON.parse(readFileSync(dbPath, 'utf-8'));

        console.log('📂 Dados carregados do db.json');
        console.log(`   - Links: ${data.links.length}`);
        console.log(`   - Products: ${data.products.length}`);
        console.log(`   - Analytics: ${data.analytics.length}`);
        console.log(`   - Leads: ${data.leads.length}\n`);

        // 2. Verificar se já existe perfil
        console.log('👤 Verificando perfil existente...');

        const { data: existingProfile } = await supabase
            .from('users')
            .select('*')
            .eq('username', 'nodus')
            .single();

        let profile;

        if (existingProfile) {
            console.log(`✅ Perfil já existe: ${existingProfile.id}`);
            console.log(`⏭️  Pulando migração (dados já foram migrados)\n`);
            profile = existingProfile;
        } else {
            console.log('👤 Criando perfil...');

            const { data: newProfile, error: profileError } = await supabase
                .from('users')
                .insert({
                    username: 'nodus',
                    name: data.profile.name,
                    bio: data.profile.bio,
                    avatar_url: data.profile.avatarUrl,
                    custom_background: data.profile.customBackground,
                    theme_id: data.profile.themeId,
                    font_family: data.profile.fontFamily,
                    button_style: data.profile.buttonStyle,
                    show_newsletter: data.profile.showNewsletter,
                    newsletter_title: data.profile.newsletterTitle,
                    newsletter_description: data.profile.newsletterDescription,
                    support_type: data.profile.supportType,
                    support_key: data.profile.supportKey,
                    seo_title: data.profile.seoTitle,
                    seo_description: data.profile.seoDescription,
                    seo_keywords: data.profile.seoKeywords,
                    custom_css: data.profile.customCSS,
                    custom_text_color: data.profile.customTextColor,
                    custom_solid_color: data.profile.customSolidColor,
                    custom_button_color: data.profile.customButtonColor
                })
                .select()
                .single();

            if (profileError) throw profileError;
            console.log(`✅ Perfil criado: ${newProfile.id}\n`);
            profile = newProfile;
        }

        // 3. Migrar links (incluindo children)
        console.log('🔗 Migrando links...');
        let linkCount = 0;

        for (const link of data.links) {
            const { data: parentLink, error: linkError } = await supabase
                .from('links')
                .insert({
                    user_id: profile.id,
                    title: link.title,
                    url: link.url,
                    icon: link.image,
                    is_active: link.isActive,
                    clicks: link.clicks || 0,
                    layout: link.layout || 'classic',
                    type: link.type || 'link',
                    highlight: link.highlight || 'none',
                    embed_type: link.embedType || 'none',
                    position: linkCount
                })
                .select()
                .single();

            if (linkError) throw linkError;
            linkCount++;

            // Migrar children se existirem
            if (link.children && link.children.length > 0) {
                for (const child of link.children) {
                    const { error: childError } = await supabase
                        .from('links')
                        .insert({
                            user_id: profile.id,
                            parent_id: parentLink.id,
                            title: child.title,
                            url: child.url,
                            icon: child.image,
                            is_active: child.isActive,
                            clicks: child.clicks || 0,
                            layout: child.layout || 'classic',
                            type: child.type || 'link',
                            highlight: child.highlight || 'none',
                            embed_type: child.embedType || 'none',
                            position: linkCount
                        });

                    if (childError) throw childError;
                    linkCount++;
                }
            }
        }

        console.log(`✅ ${linkCount} links migrados\n`);

        // 4. Migrar produtos
        console.log('🛍️  Migrando produtos...');

        if (data.products.length > 0) {
            const productsToInsert = data.products.map((product, index) => ({
                user_id: profile.id,
                name: product.name,
                price: product.price,
                image: product.image,
                url: product.url,
                discount_code: product.discountCode,
                clicks: 0,
                position: index
            }));

            const { error: productsError } = await supabase
                .from('products')
                .insert(productsToInsert);

            if (productsError) throw productsError;
            console.log(`✅ ${data.products.length} produtos migrados\n`);
        } else {
            console.log('⏭️  Nenhum produto para migrar\n');
        }

        // 5. Pular analytics (não temos mapeamento de IDs antigos para novos)
        console.log('⏭️  Pulando migração de analytics (sem mapeamento de IDs)\n');

        // 6. Migrar leads
        console.log('📧 Migrando leads de newsletter...');

        if (data.leads.length > 0) {
            const leadsToInsert = data.leads.map(lead => ({
                user_id: profile.id,
                email: lead.email,
                name: lead.name,
                timestamp: lead.timestamp
            }));

            const { error: leadsError } = await supabase
                .from('leads')
                .insert(leadsToInsert);

            if (leadsError) throw leadsError;
            console.log(`✅ ${data.leads.length} leads migrados\n`);
        } else {
            console.log('⏭️  Nenhum lead para migrar\n');
        }

        console.log('🎉 Migração concluída com sucesso!');
        console.log(`\n📝 Resumo:`);
        console.log(`   - Profile ID: ${profile.id}`);
        console.log(`   - Links: ${linkCount}`);
        console.log(`   - Produtos: ${data.products.length}`);
        console.log(`   - Analytics: ${data.analytics.length}`);
        console.log(`   - Leads: ${data.leads.length}`);

    } catch (error) {
        console.error('❌ Erro durante a migração:', error);
        process.exit(1);
    }
}

// Executar migração
migrateData();
