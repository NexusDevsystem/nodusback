import { Response, NextFunction } from 'express';
import { supabase } from '../config/supabaseClient.js';
import { AuthRequest } from './authMiddleware.js';

/**
 * 🔐 IDOR PROTECTION MIDDLEWARE
 * Verifies if the authenticated user owns the resource they are trying to access.
 * 
 * @param table - The database table to check
 * @param idParam - The name of the request parameter containing the resource ID
 */
export const checkOwnership = (table: string, idParam = 'id') => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const resourceId = req.params[idParam];
            const profileId = req.profileId;

            if (!profileId) {
                return res.status(401).json({ error: 'Unauthorized: No profile associated' });
            }

            // Superadmins bypass ownership checks to allow moderation/support
            if (req.role === 'superadmin') {
                return next();
            }

            if (!resourceId) {
                return res.status(400).json({ 
                    error: `Missing resource ID parameter: ${idParam}`,
                    code: 'MISSING_ID'
                });
            }

            // Check database for ownership
            // Most tables in Nodus use 'user_id' for the owner, which corresponds to profileId
            const { data, error } = await supabase
                .from(table)
                .select('user_id')
                .eq('id', resourceId)
                .maybeSingle();

            if (error) {
                console.error(`❌ Error checking ownership for ${table}:${resourceId}`, error);
                return res.status(500).json({ error: 'Erro interno ao validar propriedade do recurso.' });
            }

            if (!data) {
                return res.status(404).json({ error: 'Recurso não encontrado.' });
            }

            // Comparison: user_id in DB vs authenticated profileId
            if (data.user_id !== profileId) {
                console.warn(`🚨 [SECURITY] IDOR ATTEMPT: User ${profileId} tried to access ${table}:${resourceId} owned by ${data.user_id}`);
                return res.status(403).json({ 
                    error: 'Acesso negado. Você não tem permissão para modificar este recurso.',
                    code: 'OWNERSHIP_VIOLATION'
                });
            }

            // If we reach here, the user is the owner
            next();
        } catch (error) {
            console.error('❌ Ownership middleware crash:', error);
            res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    };
};
