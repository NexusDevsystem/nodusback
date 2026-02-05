import { JSONFilePreset } from 'lowdb/node';
import { UserProfile, LinkItem, Product, AnalyticsEvent, NewsletterLead } from '../models/types.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

export interface Database {
    profile: UserProfile;
    links: LinkItem[];
    products: Product[];
    analytics: AnalyticsEvent[];
    leads: NewsletterLead[];
}

const defaultData: Database = {
    profile: {
        name: 'Seu Nome',
        bio: 'Sua bio aqui',
        avatarUrl: 'https://via.placeholder.com/150',
        themeId: 'default',
        fontFamily: 'Inter',
        buttonStyle: 'rounded',
        showNewsletter: false
    },
    links: [],
    products: [],
    analytics: [],
    leads: []
};

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create data directory if it doesn't exist
const dataDir = join(__dirname, '../../data');
if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
}

const databasePath = join(dataDir, 'db.json');
console.log('📁 Database path:', databasePath);

export const db = await JSONFilePreset<Database>(databasePath, defaultData);
