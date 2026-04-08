import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';

// POST /api/verification/request
export const submitVerificationRequest = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: 'Não autenticado.' });
            return;
        }

        // Server-side subscription gate
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('plan_type, is_verified')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            res.status(404).json({ error: 'Usuário não encontrado.' });
            return;
        }

        if (!user.plan_type || user.plan_type === 'free') {
            res.status(403).json({ error: 'Apenas assinantes mensais ou anuais podem solicitar verificação.' });
            return;
        }

        if (user.is_verified) {
            res.status(409).json({ error: 'Seu perfil já está verificado.' });
            return;
        }

        // Check for existing pending request
        const { data: existing } = await supabase
            .from('verification_requests')
            .select('id, status, created_at')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .maybeSingle();

        if (existing) {
            res.status(409).json({ error: 'Você já possui uma solicitação em análise.', request: existing });
            return;
        }

        const {
            nodus_link,
            display_name,
            contact_email,
            category,
            social_link_1,
            social_link_2,
            social_link_3,
            has_verified_badge,
            press_link_1,
            press_link_2,
            press_link_3,
        } = req.body;

        // Validate required fields
        if (!nodus_link || !display_name || !contact_email || !category || !social_link_1) {
            res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
            return;
        }

        const { data: newRequest, error: insertError } = await supabase
            .from('verification_requests')
            .insert({
                user_id: userId,
                status: 'pending',
                nodus_link,
                display_name,
                contact_email,
                category,
                social_link_1,
                social_link_2: social_link_2 || null,
                social_link_3: social_link_3 || null,
                has_verified_badge: has_verified_badge === true,
                press_link_1: press_link_1 || null,
                press_link_2: press_link_2 || null,
                press_link_3: press_link_3 || null,
            })
            .select()
            .single();

        if (insertError) throw insertError;

        console.log(`✅ [Verification] Nova solicitação de ${userId} (${display_name})`);
        res.status(201).json(newRequest);

    } catch (error: any) {
        console.error('❌ Error submitting verification request:', error);
        res.status(500).json({ error: 'Erro ao enviar solicitação de verificação.' });
    }
};

// GET /api/verification/my
export const getMyVerificationRequest = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: 'Não autenticado.' });
            return;
        }

        const { data, error } = await supabase
            .from('verification_requests')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        res.json(data || null);
    } catch (error: any) {
        console.error('❌ Error fetching verification request:', error);
        res.status(500).json({ error: 'Erro ao buscar solicitação.' });
    }
};

// GET /api/admin/verifications — Admin only
export const getAdminVerificationRequests = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const isAdmin = req.role === 'superadmin';
        if (!isAdmin) {
            res.status(403).json({ error: 'Acesso negado.' });
            return;
        }

        const statusFilter = req.query.status as string | undefined;

        let query = supabase
            .from('verification_requests')
            .select(`
                *,
                users (
                    id, username, name, email, avatar_url, plan_type, is_verified
                )
            `)
            .order('created_at', { ascending: false });

        if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
            query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json(data || []);
    } catch (error: any) {
        console.error('❌ Error fetching admin verifications:', error);
        res.status(500).json({ error: 'Erro ao buscar solicitações.' });
    }
};

// PATCH /api/admin/verifications/:id/review — Admin only
export const reviewVerificationRequest = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const isAdmin = req.role === 'superadmin';
        if (!isAdmin) {
            res.status(403).json({ error: 'Acesso negado.' });
            return;
        }

        const { id } = req.params;
        const { action, reason } = req.body; // action: 'approve' | 'reject'

        if (!['approve', 'reject'].includes(action)) {
            res.status(400).json({ error: 'Ação inválida. Use "approve" ou "reject".' });
            return;
        }

        // Get the request to find the user_id
        const { data: request, error: fetchError } = await supabase
            .from('verification_requests')
            .select('user_id')
            .eq('id', id)
            .single();

        if (fetchError || !request) {
            res.status(404).json({ error: 'Solicitação não encontrada.' });
            return;
        }

        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        // Update the request
        const { error: updateError } = await supabase
            .from('verification_requests')
            .update({
                status: newStatus,
                reason: reason || null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (updateError) throw updateError;

        // If approved → set is_verified = true on the user
        if (action === 'approve') {
            const { error: userUpdateError } = await supabase
                .from('users')
                .update({ is_verified: true })
                .eq('id', request.user_id);

            if (userUpdateError) throw userUpdateError;
        }

        console.log(`✅ [Admin] Verificação ${id} → ${newStatus} por ${req.email}`);
        res.json({ success: true, status: newStatus });

    } catch (error: any) {
        console.error('❌ Error reviewing verification request:', error);
        res.status(500).json({ error: 'Erro ao processar análise.' });
    }
};
