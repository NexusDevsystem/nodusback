import 'dotenv/config';
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabaseClient.js';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('❌ VARIAVEL DE AMBIENTE FALTANDO: JWT_SECRET deve estar no .env para o middleware de autenticação funcionar.');
}

const FINAL_JWT_SECRET = JWT_SECRET;
console.log(`🔐 Auth secret initialized (Length: ${FINAL_JWT_SECRET.length})`);

export interface AuthRequest extends Request {
    userId?: string;
    profileId?: string;
    username?: string;
    email?: string;
    role?: 'user' | 'superadmin';
}

// Simple in-memory cache to avoid hammering Google API on every concurrent request
const tokenCache = new Map<string, { email: string, expiry: number }>();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minute cache

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

        // --- 1. Try internal JWT first (email/password users) ---
        try {
            const payload = jwt.verify(token, FINAL_JWT_SECRET) as { userId: string; email: string };

            // Valid internal token - look up profile directly in DB
            const { data: profile, error: profileError } = await supabase
                .from('users')
                .select('id, onboarding_completed, username')
                .eq('id', payload.userId)
                .maybeSingle();

            if (profileError || !profile) {
                return res.status(401).json({ error: 'Sessão inválida. Por favor, faça login novamente.' });
            }

            req.userId = profile.id;
            req.profileId = profile.id;
            req.username = profile.username;
            req.email = payload.email;
            req.role = (profile.username === 'nodus' || payload.email === 'jaoomarcos75@gmail.com') ? 'superadmin' : 'user';
            
            console.log(`✅ Auth (JWT): Request authorized for ${payload.email} (ID: ${profile.id}, Role: ${req.role})`);
            return next();
        } catch (jwtError) {
            // Not a valid internal JWT → fall through to Google verification
        }

        // --- 2. Check Google token cache ---
        const cached = tokenCache.get(token);
        let email = '';
        if (cached && cached.expiry > Date.now()) {
            email = cached.email;
        } else {
            // Verify with Google directly (Standard Access Token verify)
            try {
                const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 8000 // 8s timeout
                });
                email = googleRes.data?.email || '';
            } catch (err: any) {
                // If it's a 401, don't retry - it's an auth error.
                if (err.response?.status === 401) {
                    console.warn('🔑 Google Auth Rejected (401): Token is invalid or expired.');
                    return res.status(401).json({ error: 'Sessão expirada. Por favor, faça login novamente.' });
                }

                // For other errors (timeout, 5xx), retry or throw
                console.warn(`⚠️ Google Auth Error (${err.response?.status || 'Timeout'}): Retrying once...`);
                try {
                    const retryRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 12000
                    });
                    email = retryRes.data?.email || '';
                } catch (retryErr: any) {
                    console.error('❌ Google Auth failed after retry:', retryErr.message);
                    throw retryErr;
                }
            }

            if (!email) {
                return res.status(401).json({ error: 'Invalid token: email not provided by Google' });
            }

            // Cache successful verification
            tokenCache.set(token, {
                email,
                expiry: Date.now() + CACHE_DURATION
            });
        }

        // Get the user's profile from DB using email
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
        req.username = profile.username;
        req.email = sanitizedEmail;
        // In the future, role check can be profile.role === 'admin' 
        const adminEmails = (process.env.ADMIN_EMAILS || '').split(',');
        req.role = (profile.username === 'nodus' || adminEmails.includes(sanitizedEmail)) ? 'superadmin' : 'user';

        console.log(`✅ Auth: Request authorized for ${sanitizedEmail} (ID: ${profile.id}, Role: ${req.role})`);

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
