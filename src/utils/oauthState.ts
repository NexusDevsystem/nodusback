import crypto from 'crypto';
import type { Request } from 'express';

export type OAuthProvider = 'tiktok' | 'instagram' | 'twitch' | 'youtube' | 'kick';

export interface OAuthStatePayload {
    provider: OAuthProvider;
    userId: string;
    origin: string;
    verifier?: string;
    nonce: string;
    expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const usedNonces = new Map<string, number>();

const getStateSecret = () => {
    const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('OAuth state secret is not configured');
    }
    return secret;
};

const encode = (value: string) => Buffer.from(value).toString('base64url');
const decode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const sign = (value: string) => crypto
    .createHmac('sha256', getStateSecret())
    .update(value)
    .digest('base64url');

const cleanupUsedNonces = () => {
    const now = Date.now();
    for (const [nonce, expiresAt] of usedNonces) {
        if (expiresAt <= now) usedNonces.delete(nonce);
    }
};

const configuredOrigins = () => {
    const values = [
        process.env.FRONTEND_URL,
        ...(process.env.FRONTEND_ALLOWED_ORIGINS || '').split(',')
    ].filter(Boolean) as string[];

    return new Set(values.map(value => {
        try {
            return new URL(value.trim()).origin;
        } catch {
            return '';
        }
    }).filter(Boolean));
};

export const defaultFrontendOrigin = () => {
    const configured = configuredOrigins();
    return [...configured][0] || 'https://www.nodus.my';
};

export const resolveFrontendOrigin = (requestedOrigin?: string): string => {
    if (!requestedOrigin || requestedOrigin === 'production') {
        return defaultFrontendOrigin();
    }

    let origin: string;
    try {
        const parsed = new URL(requestedOrigin);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
        origin = parsed.origin;
    } catch {
        throw new Error('Invalid frontend origin');
    }

    const allowed = configuredOrigins();
    const isLocalDevelopment = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    if (isLocalDevelopment || allowed.has(origin)) return origin;

    throw new Error('Frontend origin is not allowlisted');
};

export const getBackendBaseUrl = (req: Request): string => {
    const configured = process.env.BACKEND_URL || process.env.PUBLIC_BACKEND_URL;
    if (configured) return configured.replace(/\/$/, '');

    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : req.protocol) || 'https';
    return `${protocol}://${req.get('host')}`;
};

export const createOAuthState = (
    provider: OAuthProvider,
    userId: string,
    origin: string,
    verifier?: string
): string => {
    cleanupUsedNonces();
    const payload: OAuthStatePayload = {
        provider,
        userId,
        origin: resolveFrontendOrigin(origin),
        verifier,
        nonce: crypto.randomBytes(24).toString('base64url'),
        expiresAt: Date.now() + STATE_TTL_MS
    };

    const encodedPayload = encode(JSON.stringify(payload));
    return `${encodedPayload}.${sign(encodedPayload)}`;
};

export const consumeOAuthState = (state: string, provider: OAuthProvider): OAuthStatePayload => {
    cleanupUsedNonces();
    const [encodedPayload, receivedSignature] = (state || '').split('.');
    if (!encodedPayload || !receivedSignature) throw new Error('Invalid OAuth state');

    const expectedSignature = sign(encodedPayload);
    const received = Buffer.from(receivedSignature);
    const expected = Buffer.from(expectedSignature);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
        throw new Error('Invalid OAuth state signature');
    }

    let payload: OAuthStatePayload;
    try {
        payload = JSON.parse(decode(encodedPayload)) as OAuthStatePayload;
    } catch {
        throw new Error('Invalid OAuth state payload');
    }

    if (payload.provider !== provider || payload.expiresAt <= Date.now() || !payload.userId || !payload.nonce) {
        throw new Error('Expired or invalid OAuth state');
    }
    if (usedNonces.has(payload.nonce)) throw new Error('OAuth state already used');

    usedNonces.set(payload.nonce, payload.expiresAt);
    return payload;
};
