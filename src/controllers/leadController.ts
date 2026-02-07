import { Response } from 'express';
import { leadService } from '../services/leadService.js';
import { AuthRequest } from '../middleware/authMiddleware.js';

export const leadController = {
    // Get all leads for authenticated user
    async getMyLeads(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const leads = await leadService.getLeadsByProfileId(req.profileId);
            res.json(leads);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch leads' });
        }
    },

    // Create a new lead (public access - for newsletter signups)
    async createLead(req: AuthRequest, res: Response) {
        try {
            const { profileId, email, name } = req.body;

            if (!profileId || !email) {
                return res.status(400).json({ error: 'Profile ID and email are required' });
            }

            const lead = await leadService.createLead(profileId, email, name);

            if (!lead) {
                return res.status(500).json({ error: 'Failed to create lead' });
            }

            res.status(201).json(lead);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create lead' });
        }
    },

    // Delete a lead
    async deleteLead(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const deleted = await leadService.deleteLead(id);

            if (!deleted) {
                return res.status(404).json({ error: 'Lead not found' });
            }

            res.status(204).send();
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete lead' });
        }
    }
};
