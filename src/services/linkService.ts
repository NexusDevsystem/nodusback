import { db } from '../config/database.js';
import { LinkItem } from '../models/types.js';
import { v4 as uuidv4 } from 'uuid';

export const linkService = {
    async getAllLinks(): Promise<LinkItem[]> {
        await db.read();
        return db.data.links;
    },

    async createLink(link: Omit<LinkItem, 'id'>): Promise<LinkItem> {
        await db.read();
        const newLink: LinkItem = {
            ...link,
            id: uuidv4(),
            clicks: link.clicks || 0
        };
        db.data.links.push(newLink);
        await db.write();
        return newLink;
    },

    async updateLink(id: string, updates: Partial<LinkItem>): Promise<LinkItem | null> {
        await db.read();
        const index = db.data.links.findIndex(l => l.id === id);
        if (index === -1) return null;

        db.data.links[index] = { ...db.data.links[index], ...updates };
        await db.write();
        return db.data.links[index];
    },

    async deleteLink(id: string): Promise<boolean> {
        await db.read();
        const initialLength = db.data.links.length;
        db.data.links = db.data.links.filter(l => l.id !== id);
        await db.write();
        return db.data.links.length < initialLength;
    },

    async incrementClicks(id: string): Promise<void> {
        await db.read();
        const updateClicks = (links: LinkItem[]): LinkItem[] => {
            return links.map(link => {
                if (link.id === id) {
                    return { ...link, clicks: (link.clicks || 0) + 1 };
                }
                if (link.children) {
                    return { ...link, children: updateClicks(link.children) };
                }
                return link;
            });
        };
        db.data.links = updateClicks(db.data.links);
        await db.write();
    },

    async replaceAllLinks(links: LinkItem[]): Promise<LinkItem[]> {
        await db.read();
        db.data.links = links;
        await db.write();
        return db.data.links;
    }
};
