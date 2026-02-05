import { db } from '../config/database.js';
import { NewsletterLead } from '../models/types.js';
import { v4 as uuidv4 } from 'uuid';

export const leadService = {
    async getAllLeads(): Promise<NewsletterLead[]> {
        await db.read();
        return db.data.leads;
    },

    async createLead(email: string, name?: string): Promise<NewsletterLead> {
        await db.read();
        const newLead: NewsletterLead = {
            id: uuidv4(),
            email,
            name,
            timestamp: new Date().toISOString()
        };
        db.data.leads.push(newLead);
        await db.write();
        return newLead;
    },

    async deleteLead(id: string): Promise<boolean> {
        await db.read();
        const initialLength = db.data.leads.length;
        db.data.leads = db.data.leads.filter(l => l.id !== id);
        await db.write();
        return db.data.leads.length < initialLength;
    }
};
