import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';

export const getPlatformStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const username = req.username;
        const email = req.email;

        const isAdmin = username === 'nodus' || email === 'jaoomarcos75@gmail.com';

        if (!userId || !isAdmin) {
            res.status(403).json({ error: 'Acesso negado. Apenas o administrador pode acessar esta rota.' });
            return;
        }

        // Fetch Base Counts
        const { count: totalUsers, error: usersError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        if (usersError) throw usersError;

        const { count: totalLinks, error: linksError } = await supabase
            .from('links')
            .select('*', { count: 'exact', head: true });
        if (linksError) throw linksError;

        const { count: totalProducts, error: productsError } = await supabase
            .from('products')
            .select('*', { count: 'exact', head: true });
        if (productsError) throw productsError;

        // Fetch Plan Breakdown
        const { count: proUsers, error: proError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .neq('plan_type', 'free');

        if (proError) throw proError;

        // Fetch Growth Metrics
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);

        const { count: todayUsers, error: todayError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', today.toISOString());

        if (todayError) throw todayError;

        const { count: weeklyUsers, error: weeklyError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', lastWeek.toISOString());

        if (weeklyError) throw weeklyError;

        // Fetch Latest Users (always include 'nodus' admin)
        const { data: latestUsersRaw, error: latestError } = await supabase
            .from('users')
            .select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category')
            .order('created_at', { ascending: false })
            .limit(50); // Increased limit to show more users with scroll

        if (latestError) throw latestError;

        // Ensure nodus is included if missing from the latest
        let latestUsers = latestUsersRaw || [];
        const hasNodus = latestUsers.some(u => u.username === 'nodus');

        if (!hasNodus) {
            const { data: nodusUser } = await supabase
                .from('users')
                .select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category')
                .eq('username', 'nodus')
                .single();

            if (nodusUser) {
                latestUsers = [nodusUser, ...latestUsers].slice(0, 50);
            }
        } else {
            latestUsers = latestUsers.slice(0, 50);
        }

        // Fetch Total Views
        const { count: totalViews, error: viewsError } = await supabase
            .from('clicks')
            .select('*', { count: 'exact', head: true })
            .eq('type', 'view');

        if (viewsError) throw viewsError;

        // Fetch Total Clicks
        const { count: totalClicks, error: clicksError } = await supabase
            .from('clicks')
            .select('*', { count: 'exact', head: true })
            .eq('type', 'click');

        if (clicksError) throw clicksError;

        // Calculate CTR
        const globalCTR = totalViews && totalViews > 0
            ? ((totalClicks || 0) / totalViews) * 100
            : 0;

        res.json({
            summary: {
                totalUsers: totalUsers || 0,
                proUsers: proUsers || 0,
                freeUsers: (totalUsers || 0) - (proUsers || 0),
                totalLinks: totalLinks || 0,
                totalProducts: totalProducts || 0,
                totalViews: totalViews || 0,
                totalClicks: totalClicks || 0,
                globalCTR: globalCTR.toFixed(2),
            },
            growth: {
                today: todayUsers || 0,
                thisWeek: weeklyUsers || 0
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
        const username = req.username;
        const email = req.email;
        const isAdmin = username === 'nodus' || email === 'jaoomarcos75@gmail.com';

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
        const username = req.username;
        const email = req.email;
        const isAdmin = username === 'nodus' || email === 'jaoomarcos75@gmail.com';

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
