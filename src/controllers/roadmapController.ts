import { Response } from 'express';
import { supabase } from '../config/supabaseClient.js';
import { AuthRequest } from '../middleware/authMiddleware.js';

/**
 * Public: Get all roadmap tasks
 */
export const getTasks = async (req: AuthRequest, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('roadmap_tasks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return res.json(data);
    } catch (error: any) {
        console.error('Error fetching roadmap tasks:', error);
        return res.status(500).json({ error: 'Failed to fetch roadmap tasks' });
    }
};

/**
 * Public: Create a new task (goes directly to backlog)
 */
export const createTask = async (req: AuthRequest, res: Response) => {
    try {
        const { title, description, author_name } = req.body;

        if (!title || title.trim().length < 3) {
            return res.status(400).json({ error: 'Título deve ter pelo menos 3 caracteres.' });
        }

        const { data, error } = await supabase
            .from('roadmap_tasks')
            .insert({
                title: title.trim().substring(0, 150),
                description: description?.trim().substring(0, 500) || null,
                author_name: author_name?.trim().substring(0, 80) || null,
                status: 'backlog',
                votes: 0,
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json(data);
    } catch (error: any) {
        console.error('Error creating roadmap task:', error);
        return res.status(500).json({ error: 'Failed to create roadmap task' });
    }
};

/**
 * Superadmin: Update task status
 */
export const updateTaskStatus = async (req: AuthRequest, res: Response) => {
    try {
        if (req.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['backlog', 'planned', 'in_progress', 'done'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Status inválido.' });
        }

        const { data, error } = await supabase
            .from('roadmap_tasks')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return res.json(data);
    } catch (error: any) {
        console.error('Error updating roadmap task status:', error);
        return res.status(500).json({ error: 'Failed to update task status' });
    }
};

/**
 * Superadmin: Delete a task
 */
export const deleteTask = async (req: AuthRequest, res: Response) => {
    try {
        if (req.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { id } = req.params;
        const { error } = await supabase
            .from('roadmap_tasks')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return res.status(204).send();
    } catch (error: any) {
        console.error('Error deleting roadmap task:', error);
        return res.status(500).json({ error: 'Failed to delete task' });
    }
};

/**
 * Public: Vote on a task
 */
export const voteTask = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'up' (default) or 'down'

        const { data: current, error: fetchError } = await supabase
            .from('roadmap_tasks')
            .select('votes')
            .eq('id', id)
            .single();

        if (fetchError || !current) {
            return res.status(404).json({ error: 'Task não encontrada.' });
        }

        const diff = type === 'down' ? -1 : 1;
        const newVotes = Math.max(0, (current.votes || 0) + diff);

        const { data, error } = await supabase
            .from('roadmap_tasks')
            .update({ votes: newVotes })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return res.json(data);
    } catch (error: any) {
        console.error('Error voting on task:', error);
        return res.status(500).json({ error: 'Failed to vote on task' });
    }
};
