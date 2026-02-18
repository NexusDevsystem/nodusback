import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabaseClient.js';
import axios from 'axios';

export interface AuthRequest extends Request {
    userId?: string;
    profileId?: string;
}

// Simple in-memory cache to avoid hammering Google API on every concurrent request
const tokenCache = new Map<string, { email: string, expiry: number }>();
const CACHE_DURATION = 60 * 1000; // 1 minute cache

export const authMiddleware = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No authorization token provided' });
        }

        const token = authHeader.substring(7);

        // Check cache first
        const cached = tokenCache.get(token);
        let email = '';

        if (cached && cached.expiry > Date.now()) {
            email = cached.email;
        } else {
            // Verify the token with Google directly with a 5s timeout
            const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 5000
            });

            const googleUser = googleRes.data as { email?: string };
            email = googleUser.email || '';

            if (email) {
                tokenCache.set(token, {
                    email,
                    expiry: Date.now() + CACHE_DURATION
                });
            }
        }

        if (!email) {
            return res.status(401).json({ error: 'Invalid token or email not found' });
        }

        // Get the user's profile from DB using email
        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        if (profileError || !profile) {
            console.error('User not found for email:', email);
            return res.status(404).json({ error: 'User profile not found. Please complete onboarding.' });
        }

        // Attach user and profile info to request
        // Since we aren't using Supabase Auth IDs here, we use the record ID from our 'users' table
        req.userId = profile.id;
        req.profileId = profile.id;

        console.log(`✅ Auth: Request authorized for ${email}`);

        next();
    } catch (error: any) {
        console.error('Auth middleware error:', error.message);
        if (error.response?.status === 401) {
            return res.status(401).json({ error: 'Sessão expirada. Por favor, faça login novamente.' });
        }
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// Optional auth middleware (doesn't fail if no token)
export const optionalAuthMiddleware = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);

            // Check cache first
            const cached = tokenCache.get(token);
            let email = '';

            if (cached && cached.expiry > Date.now()) {
                email = cached.email;
            } else {
                try {
                    const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 5000
                    });

                    if (googleRes.status === 200) {
                        const googleUser = googleRes.data as { email?: string };
                        email = googleUser.email || '';

                        if (email) {
                            tokenCache.set(token, {
                                email,
                                expiry: Date.now() + CACHE_DURATION
                            });
                        }
                    }
                } catch (e) {
                    // Ignore errors in optional auth
                }
            }

            if (email) {
                const { data: profile } = await supabase
                    .from('users')
                    .select('id')
                    .eq('email', email)
                    .maybeSingle();

                if (profile) {
                    req.userId = profile.id;
                    req.profileId = profile.id;
                }
            }
        }

        next();
    } catch (error) {
        console.error('Optional auth middleware error:', error);
        next();
    }
};
