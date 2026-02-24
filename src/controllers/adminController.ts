import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient.js';

export const getPlatformStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        const username = (req as any).user?.username;

        if (!userId || username !== 'nodus') {
            res.status(403).json({ error: 'Acesso negado. Apenas o administrador pode acessar esta rota.' });
            return;
        }

        // Fetch Total Users
        const { count: totalUsers, error: usersError } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        if (usersError) throw usersError;

        // Fetch Total Links
        const { count: totalLinks, error: linksError } = await supabase
            .from('links')
            .select('*', { count: 'exact', head: true });

        if (linksError) throw linksError;

        // Fetch Total Products (Digital)
        const { count: totalProducts, error: productsError } = await supabase
            .from('digital_products')
            .select('*', { count: 'exact', head: true });

        if (productsError) throw productsError;

        // Fetch Total Global Views
        // Summing up all views from the 'profiles' table
        const { data: viewsData, error: viewsError } = await supabase
            .from('profiles')
            .select('views');

        if (viewsError) throw viewsError;

        const totalViews = viewsData.reduce((acc, profile) => acc + (profile.views || 0), 0);

        // Fetch Total Global Clicks
        // Summing up all clicks from the 'links' table
        const { data: clicksData, error: clicksError } = await supabase
            .from('links')
            .select('clicks');

        if (clicksError) throw clicksError;

        const totalClicks = clicksData.reduce((acc, link) => acc + (link.clicks || 0), 0);

        res.json({
            totalUsers: totalUsers || 0,
            totalLinks: totalLinks || 0,
            totalProducts: totalProducts || 0,
            totalViews: totalViews,
            totalClicks: totalClicks
        });

    } catch (error: any) {
        console.error('❌ Error fetching admin stats:', error);
        res.status(500).json({ error: 'Erro ao carregar estatísticas da plataforma.' });
    }
};
