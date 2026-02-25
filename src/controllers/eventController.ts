import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { eventService } from '../services/eventService.js';
import { EventItem } from '../models/types.js';

export const eventController = {
    // Upsert events for a collection (bulk update)
    async bulkUpsertEvents(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

            const { collectionId, events } = req.body;
            if (!collectionId) return res.status(400).json({ error: 'Collection ID is required' });

            const savedEvents = await eventService.replaceEvents(req.userId, collectionId, events);
            res.json(savedEvents);
        } catch (error: any) {
            console.error('Error upserting events:', error);
            res.status(500).json({ error: 'Failed to save events' });
        }
    },

    // Create a single event
    async createEvent(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

            const eventData = req.body;
            const event = await eventService.createEvent(req.userId, eventData);

            if (!event) return res.status(500).json({ error: 'Failed to create event' });
            res.status(201).json(event);
        } catch (error: any) {
            console.error('Error creating event:', error);
            res.status(500).json({ error: 'Failed to create event' });
        }
    },

    // Update an event
    async updateEvent(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

            const { id } = req.params;
            const updates = req.body;

            const event = await eventService.updateEvent(id, updates);
            if (!event) return res.status(404).json({ error: 'Event not found' });

            res.json(event);
        } catch (error: any) {
            console.error('Error updating event:', error);
            res.status(500).json({ error: 'Failed to update event' });
        }
    },

    // Delete an event
    async deleteEvent(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

            const { id } = req.params;
            const success = await eventService.deleteEvent(id);

            if (!success) return res.status(500).json({ error: 'Failed to delete event' });
            res.status(204).send();
        } catch (error: any) {
            console.error('Error deleting event:', error);
            res.status(500).json({ error: 'Failed to delete event' });
        }
    }
};
