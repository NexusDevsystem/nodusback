import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabaseClient.js';
import axios from 'axios';

export interface AuthRequest extends Request {
    userId?: string;
    profileId?: string;
}

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

        // Verify the token with Google directly
        // This avoids needing to enable the Google provider in Supabase Dashboard
        const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });

        const googleUser = googleRes.data as { email?: string };
        const email = googleUser.email;

        if (!email) {
            return res.status(401).json({ error: 'Token does not contain email' });
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

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
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

            const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (googleRes.status === 200) {
                const googleUser = googleRes.data as { email?: string };
                const email = googleUser.email;

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
        }

        next();
    } catch (error) {
        console.error('Optional auth middleware error:', error);
        next();
    }
};
