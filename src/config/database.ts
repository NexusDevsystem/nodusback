import { JSONFilePreset } from 'lowdb/node';
import { UserProfile, LinkItem, Product, AnalyticsEvent, NewsletterLead } from '../models/types.js';

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

const databasePath = process.env.DATABASE_PATH || './data/db.json';

export const db = await JSONFilePreset<Database>(databasePath, defaultData);
