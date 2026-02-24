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

        // Fetch Total Users
        const { count: totalUsers, error: usersError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        if (usersError) throw usersError;

        // Fetch Total Links
        const { count: totalLinks, error: linksError } = await supabase
            .from('links')
            .select('*', { count: 'exact', head: true });

        if (linksError) throw linksError;

        // Fetch Total Products
        const { count: totalProducts, error: productsError } = await supabase
            .from('products')
            .select('*', { count: 'exact', head: true });

        if (productsError) throw productsError;

        // Fetch Total Global Views (Counting from 'clicks' table)
        const { count: totalViews, error: viewsError } = await supabase
            .from('clicks')
            .select('*', { count: 'exact', head: true })
            .eq('type', 'view');

        if (viewsError) throw viewsError;

        // Fetch Total Global Clicks (Counting from 'clicks' table)
        const { count: totalClicks, error: clicksError } = await supabase
            .from('clicks')
            .select('*', { count: 'exact', head: true })
            .eq('type', 'click');

        if (clicksError) throw clicksError;

        res.json({
            totalUsers: totalUsers || 0,
            totalLinks: totalLinks || 0,
            totalProducts: totalProducts || 0,
            totalViews: totalViews || 0,
            totalClicks: totalClicks || 0
        });

    } catch (error: any) {
        console.error('❌ Error fetching admin stats:', error);
        res.status(500).json({ error: 'Erro ao carregar estatísticas da plataforma.' });
    }
};
