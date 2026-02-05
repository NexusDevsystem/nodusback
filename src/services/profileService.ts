import { db } from '../config/database.js';
import { UserProfile } from '../models/types.js';

export const profileService = {
    async getProfile(): Promise<UserProfile> {
        await db.read();
        return db.data.profile;
    },

    async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
        await db.read();
        db.data.profile = { ...db.data.profile, ...updates };
        await db.write();
        return db.data.profile;
    }
};
