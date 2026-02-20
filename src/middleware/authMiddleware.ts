import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabaseClient.js';
import axios from 'axios';

export interface AuthRequest extends Request {
    userId?: string;
    profileId?: string;
}

// Simple in-memory cache to avoid hammering Google API on every concurrent request
const tokenCache = new Map<string, { email: string, expiry: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minute cache

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
            // Verify the token with Google directly with a 10s timeout and a retry
            let googleUser;
            try {
                const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 10000
                });
                googleUser = googleRes.data;
            } catch (retryErr) {
                console.warn('Google Auth failed, retrying once...');
                const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 15000
                });
                googleUser = googleRes.data;
            }

            email = googleUser?.email || '';

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

        // Get the user's profile from DB using email (Sanitized exact match)
        const sanitizedEmail = email.toLowerCase().trim();
        let { data: profile, error: profileError } = await supabase
            .from('users')
            .select('id, onboarding_completed, username')
            .eq('email', sanitizedEmail)
            .maybeSingle();

        if (profileError) {
            console.error('Database error during auth:', profileError);
            return res.status(500).json({ error: 'Internal server error during authentication' });
        }

        // AUTO-CREATE: If no record exists, create a basic one immediately
        // This prevents the 404 catch-22 for new users.
        if (!profile) {
            console.log(`🆕 Creating stub record for new user: ${email}`);
            const { data: newProfile, error: createError } = await supabase
                .from('users')
                .insert({
                    email: sanitizedEmail,
                    name: email.split('@')[0], // Default name from email
                    onboarding_completed: false,
                    auth_provider: 'google',
                    theme_id: 'default', // Fallback to a default theme
                    font_family: 'Inter'
                })
                .select('id, onboarding_completed, username')
                .single();

            if (createError) {
                console.error('Failed to auto-create user record:', createError);
                return res.status(500).json({ error: 'Failed to initialize user session' });
            }
            profile = newProfile;
        }

        if (!profile) {
            console.error('❌ Profile missing after creation/fetch for:', sanitizedEmail);
            return res.status(500).json({ error: 'Failed to retrieve user profile' });
        }

        // Attach user and profile info to request
        req.userId = profile.id;
        req.profileId = profile.id;

        console.log(`✅ Auth: Request authorized for ${sanitizedEmail} (ID: ${profile.id}, Onboarded: ${profile.onboarding_completed ?? 'N/A'}, Username: ${profile.username || 'N/A'})`);

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
