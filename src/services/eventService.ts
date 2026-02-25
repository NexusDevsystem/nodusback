import { supabase } from '../config/supabaseClient.js';
import { EventItem, EventItemDB, eventDbToApi, eventApiToDb } from '../models/types.js';

export const eventService = {
    // Get all events for a user
    async getEventsByUserId(userId: string): Promise<EventItem[]> {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('user_id', userId)
            .order('position', { ascending: true });

        if (error) {
            console.error('Error fetching events:', error);
            return [];
        }

        return (data as EventItemDB[]).map(db => eventDbToApi(db));
    },

    // Get events for a specific collection (agenda)
    async getEventsByCollectionId(collectionId: string): Promise<EventItem[]> {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('collection_id', collectionId)
            .order('position', { ascending: true });

        if (error) {
            console.error('Error fetching collection events:', error);
            return [];
        }

        return (data as EventItemDB[]).map(db => eventDbToApi(db));
    },

    // Create an event
    async createEvent(userId: string, event: Omit<EventItem, 'id'>): Promise<EventItem | null> {
        const dbEvent = eventApiToDb(event as any, userId);

        const { data, error } = await supabase
            .from('events')
            .insert(dbEvent)
            .select()
            .single();

        if (error) {
            console.error('Error creating event:', error);
            return null;
        }

        return eventDbToApi(data as EventItemDB);
    },

    // Update an event
    async updateEvent(eventId: string, updates: Partial<EventItem>): Promise<EventItem | null> {
        const dbUpdates: Partial<EventItemDB> = {};
        if (updates.title !== undefined) dbUpdates.title = updates.title;
        if (updates.date !== undefined) dbUpdates.date = updates.date;
        if (updates.location !== undefined) dbUpdates.location = updates.location;
        if (updates.url !== undefined) dbUpdates.url = updates.url;
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.position !== undefined) dbUpdates.position = updates.position;

        const { data, error } = await supabase
            .from('events')
            .update(dbUpdates)
            .eq('id', eventId)
            .select()
            .single();

        if (error) {
            console.error('Error updating event:', error);
            return null;
        }

        return eventDbToApi(data as EventItemDB);
    },

    // Delete an event
    async deleteEvent(eventId: string): Promise<boolean> {
        const { error } = await supabase
            .from('events')
            .delete()
            .eq('id', eventId);

        if (error) {
            console.error('Error deleting event:', error);
            return false;
        }

        return true;
    },

    // Bulk update events for a collection
    async replaceEvents(userId: string, collectionId: string, events: EventItem[]): Promise<EventItem[]> {
        // Simple implementation: delete and re-insert (or upsert if preferred)
        // For simplicity and to handle positional changes cleanly, delete/insert is often easier

        // 1. Delete existing for this collection
        await supabase.from('events').delete().eq('collection_id', collectionId);

        if (events.length === 0) return [];

        // 2. Insert new ones
        const dbEvents = events.map((e, idx) => {
            const db = eventApiToDb(e, userId);
            db.collection_id = collectionId;
            db.position = idx;
            delete db.id; // Let DB generate new IDs or use provided ones if we wanted upsert
            return db;
        });

        const { data, error } = await supabase
            .from('events')
            .insert(dbEvents)
            .select();

        if (error) {
            console.error('Error replacing events:', error);
            return [];
        }

        return (data as EventItemDB[]).map(db => eventDbToApi(db));
    }
};
