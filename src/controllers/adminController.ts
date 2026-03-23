import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';

export const getPlatformStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const isAdmin = req.role === 'superadmin';
        const userId = req.userId;

        if (!userId || !isAdmin) {
            res.status(403).json({ error: 'Acesso negado. Apenas o administrador pode acessar esta rota.' });
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);

        // Run all queries in parallel for maximum performance
        const [
            usersRes,
            linksRes,
            productsRes,
            proRes,
            todayRes,
            weeklyRes,
            latestRes,
            viewsRes,
            clicksRes,
            uniqueVisitorsRes
        ] = await Promise.all([
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('links').select('*', { count: 'exact', head: true }),
            supabase.from('products').select('*', { count: 'exact', head: true }),
            supabase.from('users').select('*', { count: 'exact', head: true }).neq('plan_type', 'free'),
            supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
            supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', lastWeek.toISOString()),
            supabase.from('users').select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category, subscription_expiry_date, theme_id').order('created_at', { ascending: false }).limit(50),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('type', 'view'),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('type', 'click'),
            supabase.from('clicks').select('fingerprint').eq('type', 'view').not('fingerprint', 'is', null)
        ]);

        // Check for all errors
        const errors = [usersRes, linksRes, productsRes, proRes, todayRes, weeklyRes, latestRes, viewsRes, clicksRes, uniqueVisitorsRes]
            .filter(r => r.error)
            .map(r => r.error);
        
        if (errors.length > 0) {
            console.error('⚠️ Multiple errors in admin stats queries:', errors);
            // We only throw if critical data is missing
            if (usersRes.error || latestRes.error) throw usersRes.error || latestRes.error;
        }

        // Ensure nodus is included if missing from the latest
        let latestUsers = latestRes.data || [];
        const hasNodus = latestUsers.some((u: any) => u.username === 'nodus');

        if (!hasNodus) {
            const { data: nodusUser } = await supabase
                .from('users')
                .select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category, subscription_expiry_date, theme_id')
                .eq('username', 'nodus')
                .single();

            if (nodusUser) {
                latestUsers = [nodusUser, ...latestUsers].slice(0, 50);
            }
        } else {
            latestUsers = latestUsers.slice(0, 50);
        }

        const totalUsers = usersRes.count || 0;
        const proUsers = proRes.count || 0;
        const totalViews = viewsRes.count || 0;
        const totalClicks = clicksRes.count || 0;
        const uniqueVisitors = new Set((uniqueVisitorsRes.data || []).map((v: any) => v.fingerprint)).size;

        // Calculate CTR
        const globalCTR = totalViews > 0
            ? (totalClicks / totalViews) * 100
            : 0;

        res.json({
            summary: {
                totalUsers,
                proUsers,
                freeUsers: totalUsers - proUsers,
                totalLinks: linksRes.count || 0,
                totalProducts: productsRes.count || 0,
                totalViews,
                uniqueVisitors,
                totalClicks,
                globalCTR: globalCTR.toFixed(2),
            },
            growth: {
                today: todayRes.count || 0,
                thisWeek: weeklyRes.count || 0
            },
            latestUsers: latestUsers || []
        });

    } catch (error: any) {
        console.error('❌ Error fetching admin stats:', error);
        res.status(500).json({ error: 'Erro ao carregar estatísticas da plataforma.' });
    }
};

export const updateUserProfile = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const isAdmin = req.role === 'superadmin';

        if (!userId || !isAdmin) {
            res.status(403).json({ error: 'Acesso negado. Apenas o administrador pode realizar esta ação.' });
            return;
        }

        const { targetUserId } = req.params;
        const updates = req.body;

        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', targetUserId)
            .select()
            .single();

        if (error) throw error;

        res.json(data);
    } catch (error: any) {
        console.error('❌ Error updating user profile:', error);
        res.status(500).json({ error: 'Erro ao atualizar perfil do usuário.' });
    }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const isAdmin = req.role === 'superadmin';

        if (!userId || !isAdmin) {
            res.status(403).json({ error: 'Acesso negado. Apenas o administrador pode realizar esta ação.' });
            return;
        }

        const { targetUserId } = req.params;

        // Note: This only deletes from the 'users' table. 
        // If using Supabase Auth, you might also want to call supabase.auth.admin.deleteUser(targetUserId)
        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', targetUserId);

        if (error) throw error;

        res.json({ success: true });
    } catch (error: any) {
        console.error('❌ Error deleting user:', error);
        res.status(500).json({ error: 'Erro ao deletar usuário.' });
    }
};

export const getUserStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const isAdmin = req.role === 'superadmin';
        const userId = req.userId;

        if (!userId || !isAdmin) {
            res.status(403).json({ error: 'Acesso negado.' });
            return;
        }

        const { targetUserId } = req.params;

        // Fetch everything in parallel
        const [userRes, viewsRes, clicksRes, linksRes, productsRes] = await Promise.all([
            supabase.from('users').select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category, subscription_expiry_date, theme_id').eq('id', targetUserId).single(),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).eq('type', 'view'),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).eq('type', 'click'),
            supabase.from('links').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
            supabase.from('products').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId)
        ]);

        if (userRes.error) throw userRes.error;

        const views = viewsRes.count || 0;
        const clicks = clicksRes.count || 0;
        const linksCount = linksRes.count || 0;
        const productsCount = productsRes.count || 0;

        res.json({
            ...userRes.data,
            views,
            clicks_count: clicks,
            links_count: linksCount,
            products_count: productsCount,
            // Keep original fields for compatibility with existing components
            clicks: [{ count: clicks }],
            links: [{ count: linksCount }],
            products: [{ count: productsCount }]
        });

    } catch (error: any) {
        console.error('❌ Error fetching individual user stats:', error);
        res.status(500).json({ error: 'Erro ao carregar detalhes do usuário.' });
    }
};
