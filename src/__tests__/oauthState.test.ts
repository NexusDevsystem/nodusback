import { describe, expect, test, beforeEach } from '@jest/globals';
import { consumeOAuthState, createOAuthState, resolveFrontendOrigin } from '../utils/oauthState.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-oauth-state-secret';

describe('OAuth state protection', () => {
    beforeEach(() => {
        process.env.FRONTEND_URL = 'https://www.nodus.my';
        delete process.env.FRONTEND_ALLOWED_ORIGINS;
    });

    test('creates and consumes a signed state once', () => {
        const state = createOAuthState('twitch', 'user-1', 'https://www.nodus.my');
        const payload = consumeOAuthState(state, 'twitch');

        expect(payload.userId).toBe('user-1');
        expect(payload.origin).toBe('https://www.nodus.my');
        expect(() => consumeOAuthState(state, 'twitch')).toThrow('already used');
    });

    test('rejects a state changed to another provider', () => {
        const state = createOAuthState('youtube', 'user-1', 'https://www.nodus.my');
        expect(() => consumeOAuthState(state, 'twitch')).toThrow('Expired or invalid OAuth state');
    });

    test('rejects an unallowlisted redirect origin', () => {
        expect(() => resolveFrontendOrigin('https://attacker.example')).toThrow('not allowlisted');
    });

    test('allows localhost only for local development', () => {
        expect(resolveFrontendOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    });
});
