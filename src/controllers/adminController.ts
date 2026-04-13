import { Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';
import { realtimeManager } from '../realtime/RealtimeManager.js';

const JWT_SECRET = process.env.JWT_SECRET || '';


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

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
            supabase.from('users').select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category, subscription_expiry_date, theme_id, referral_source').order('created_at', { ascending: false }).limit(50),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('type', 'view'),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('type', 'click'),
            supabase.from('clicks').select('fingerprint').eq('type', 'view').not('fingerprint', 'is', null)
        ]);

        // Check for all errors
        const queryErrors = [
            { name: 'users', error: usersRes.error },
            { name: 'links', error: linksRes.error },
            { name: 'products', error: productsRes.error },
            { name: 'pro', error: proRes.error },
            { name: 'today', error: todayRes.error },
            { name: 'weekly', error: weeklyRes.error },
            { name: 'latest', error: latestRes.error },
            { name: 'views', error: viewsRes.error },
            { name: 'clicks', error: clicksRes.error },
            { name: 'uniqueVisitors', error: uniqueVisitorsRes.error }
        ].filter(q => q.error);
        
        if (queryErrors.length > 0) {
            console.error('⚠️ Errors in admin stats queries:', queryErrors.map(q => ({
                query: q.name,
                code: (q.error as any)?.code,
                message: q.error?.message,
                details: (q.error as any)?.details
            })));
            
            // Critical queries failure
            if (usersRes.error) throw usersRes.error;
            if (latestRes.error) throw latestRes.error;
        }

        // Ensure nodus is included if missing from the latest
        let latestUsers = latestRes.data || [];
        const hasNodus = latestUsers.some((u: any) => u.username === 'nodus');

        if (!hasNodus) {
            const { data: nodusUser } = await supabase
                .from('users')
                .select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category, subscription_expiry_date, theme_id, referral_source')
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

        const activeUsernames = realtimeManager?.getActiveUsernames() || [];

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
            latestUsers: (latestUsers || []).map((u: any) => ({
                ...u,
                is_online: activeUsernames.includes((u.username || '').toLowerCase())
            }))
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
            supabase.from('users').select('id, username, email, name, created_at, plan_type, bio, avatar_url, is_verified, user_category, subscription_expiry_date, theme_id, referral_source, onboarding_completed').eq('id', targetUserId).single(),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).eq('type', 'view'),
            supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).eq('type', 'click'),
            supabase.from('links').select('id, title, url, type, is_active, is_archived, platform, clicks, position').eq('user_id', targetUserId).eq('is_archived', false).order('position', { ascending: true }),
            supabase.from('products').select('id, name, price, image, url, is_active, store_id').eq('user_id', targetUserId).order('created_at', { ascending: false })
        ]);

        if (userRes.error) throw userRes.error;
        if (linksRes.error) console.error('⚠️ Links query error:', linksRes.error);
        if (productsRes.error) console.error('⚠️ Products query error:', productsRes.error);

        const views = viewsRes.count || 0;
        const clicks = clicksRes.count || 0;
        const links = linksRes.data || [];
        const products = productsRes.data || [];
        const isOnline = userRes.data?.username ? (realtimeManager?.isUserOnline(userRes.data.username) || false) : false;

        res.json({
            ...userRes.data,
            is_online: isOnline,
            views,
            clicks_count: clicks,
            links_count: links.length,
            products_count: products.length,
            links,
            products,
            // Keep original logic for counting if needed elsewhere, but now with data
            clicks: [{ count: clicks }]
        });

    } catch (error: any) {
        console.error('❌ Error fetching individual user stats:', error);
        res.status(500).json({ error: 'Erro ao carregar detalhes do usuário.' });
    }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const isAdmin = req.role === 'superadmin';
        const userId = req.userId;

        if (!userId || !isAdmin) {
            res.status(403).json({ error: 'Acesso negado.' });
            return;
        }

        const { email, password, name, username, plan_type, subscription_expiry_date } = req.body;

        if (!email || !password || !username) {
            res.status(400).json({ error: 'Email, senha e username são obrigatórios.' });
            return;
        }

        const sanitizedEmail = email.toLowerCase().trim();
        const sanitizedUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .or(`email.eq.${sanitizedEmail},username.eq.${sanitizedUsername}`)
            .maybeSingle();

        if (existingUser) {
            res.status(409).json({ error: 'Email ou username já estão em uso.' });
            return;
        }

        // Hash the password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create the user
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email: sanitizedEmail,
                username: sanitizedUsername,
                name: name || sanitizedUsername,
                password_hash: passwordHash,
                auth_provider: 'email',
                plan_type: plan_type || 'free',
                subscription_expiry_date: subscription_expiry_date || null,
                subscription_status: (subscription_expiry_date || (plan_type && plan_type !== 'free')) ? 'active' : 'canceled',
                theme_id: 'default',
                font_family: 'Inter',
                is_verified: false,
                onboarding_completed: true
            })
            .select('*')
            .single();

        if (createError) throw createError;

        console.log(`👤 [Admin] Novo usuário criado: ${sanitizedEmail} por ${req.email}`);
        res.status(201).json(newUser);

    } catch (error: any) {
        console.error('❌ Error creating user from admin:', error);
        res.status(500).json({ error: 'Erro ao criar novo usuário.' });
    }
};

export const impersonateUser = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const isAdmin = req.role === 'superadmin';
        const userId = req.userId;

        if (!userId || !isAdmin) {
            res.status(403).json({ error: 'Acesso negado.' });
            return;
        }

        const { targetUserId } = req.params;

        // Fetch user data
        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, username, name')
            .eq('id', targetUserId)
            .single();

        if (error || !user) {
            res.status(404).json({ error: 'Usuário não encontrado.' });
            return;
        }

        // Generate a standard user JWT but with isImpersonated flag
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                username: user.username, 
                provider: 'email',
                isImpersonated: true,
                adminId: userId // Track who is impersonating for logs
            },
            JWT_SECRET,
            { expiresIn: '2h' } // Short lived for security
        );

        console.log(`🕵️ [Admin] Impersonation started: ${req.email} is impersonating ${user.email}`);

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                username: user.username
            }
        });

    } catch (error: any) {
        console.error('❌ Error in impersonation:', error);
        res.status(500).json({ error: 'Erro ao iniciar sessão de impersonação.' });
    }
};
