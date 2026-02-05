import { Request, Response } from 'express';
import { leadService } from '../services/leadService.js';

export const leadController = {
    async getAllLeads(req: Request, res: Response) {
        try {
            const leads = await leadService.getAllLeads();
            res.json(leads);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch leads' });
        }
    },

    async createLead(req: Request, res: Response) {
        try {
            const { email, name } = req.body;
            if (!email) {
                return res.status(400).json({ error: 'Email is required' });
            }
            const lead = await leadService.createLead(email, name);
            res.status(201).json(lead);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create lead' });
        }
    },

    async deleteLead(req: Request, res: Response) {
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
