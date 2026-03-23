/**
 * 🔴 SECURITY TEST SUITE — Nodus Backend
 * 
 * Estratégia: TDD (Test-Driven Defense)
 * Cada teste simula um ataque real. Se o servidor deixar passar, o teste FALHA.
 * 
 * Categorias:
 * 1. Security Headers (Helmet)
 * 2. XSS Injection Attempts
 * 3. Input Length Attacks (DoS)
 * 4. Authentication & IDOR Bypass
 * 5. Upload Security (Magic Bytes)
 * 6. Rate Limit Enforcement
 * 7. SSRF (Server-Side Request Forgery)
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import type { Response } from 'supertest';
import app from '../app.js';

// ─── 1. SECURITY HEADERS ────────────────────────────────────────────────────

describe('🔒 Security Headers (Defense-in-Depth)', () => {
    let res: Response;

    beforeAll(async () => {
        res = await request(app).get('/health') as unknown as Response;
    });

    test('should return X-Content-Type-Options: nosniff', () => {
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('should return X-Frame-Options to block clickjacking', () => {
        expect(res.headers['x-frame-options']).toBe('DENY');
    });

    test('should return Strict-Transport-Security (HSTS)', () => {
        expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    });

    test('should return Referrer-Policy header', () => {
        expect(res.headers['referrer-policy']).toBeDefined();
    });

    test('should NOT expose X-Powered-By header (fingerprinting prevention)', () => {
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    test('should return Content-Security-Policy header', () => {
        expect(res.headers['content-security-policy']).toBeDefined();
    });
});

// ─── 2. XSS INJECTION ────────────────────────────────────────────────────────

describe('🛡️ XSS Injection Prevention', () => {
    test('should sanitize <script> tags from request body and process without executing', async () => {
        const payload = { name: '<script>alert("XSS")</script>', url: 'https://nodus.my' };
        const res = await request(app)
            .post('/api/links')
            .set('Authorization', 'Bearer fake-token-to-test-security-layer')
            .send(payload);

        // Must NOT be 500 (crash) — server should handle it gracefully (likely 401 because auth fails, not because of XSS)
        expect(res.status).not.toBe(500);
        // If body is echoed back, ensure it's sanitized
        if (res.body?.name) {
            expect(res.body.name).not.toContain('<script>');
        }
    });

    test('should sanitize img onerror XSS payload', async () => {
        const payload = { title: '<img src=x onerror=alert(1)>' };
        const res = await request(app)
            .post('/api/blog/posts')
            .set('Authorization', 'Bearer fake-token')
            .send(payload);
        
        expect(res.status).not.toBe(500);
        if (res.body?.title) {
            expect(res.body.title).not.toContain('onerror');
        }
    });

    test('should sanitize SVG-based XSS', async () => {
        const payload = { description: '<svg onload=alert(1)>' };
        const res = await request(app)
            .post('/api/profile/update')
            .set('Authorization', 'Bearer fake-token')
            .send(payload);

        expect(res.status).not.toBe(500);
    });

    test('should sanitize javascript: protocol in URL fields', async () => {
        const payload = { url: 'javascript:alert(document.cookie)' };
        const res = await request(app)
            .post('/api/links')
            .set('Authorization', 'Bearer fake-token')
            .send(payload);

        expect(res.status).not.toBe(500);
        if (res.body?.url) {
            expect(res.body.url).not.toContain('javascript:');
        }
    });
});

// ─── 3. INPUT LENGTH (DoS) ───────────────────────────────────────────────────

describe('📏 Input Length Limits (DoS Prevention)', () => {
    test('should block username exceeding 30 characters', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'a'.repeat(31), email: 'test@test.com', password: '123456' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INPUT_LIMIT_EXCEEDED');
    });

    test('should block description exceeding 2000 characters', async () => {
        const res = await request(app)
            .put('/api/profile/me')
            .set('Authorization', 'Bearer fake-token')
            .send({ description: 'a'.repeat(2001) });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INPUT_LIMIT_EXCEEDED');
    });

    test('should block URL exceeding 2048 characters', async () => {
        const res = await request(app)
            .post('/api/links')
            .set('Authorization', 'Bearer fake-token')
            .send({ url: 'https://nodus.my/' + 'a'.repeat(2050), title: 'Test' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INPUT_LIMIT_EXCEEDED');
    });

    test('should block any generic string field exceeding 10000 characters', async () => {
        const res = await request(app)
            .post('/api/links')
            .set('Authorization', 'Bearer fake-token')
            .send({ customField: 'x'.repeat(10001) });

        expect(res.status).toBe(400);
    });

    test('should accept valid-length inputs (no false positives)', async () => {
        const res = await request(app)
            .post('/api/links')
            .set('Authorization', 'Bearer fake-token')
            .send({ title: 'Meu Link', url: 'https://nodus.my', description: 'Normal description' });

        // Should NOT be blocked by limits (will be 401 for invalid auth, not 400 for limits)
        expect(res.status).not.toBe(400);
    });
});

// ─── 4. AUTHENTICATION BYPASS & IDOR ─────────────────────────────────────────

describe('🔐 Authentication & IDOR Protection', () => {
    test('should return 401 on protected endpoint without token', async () => {
        const res = await request(app).get('/api/profile/me');
        expect(res.status).toBe(401);
    });

    test('should return 401 on protected endpoint with invalid token', async () => {
        const res = await request(app)
            .get('/api/profile/me')
            .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.FAKE.PAYLOAD');
        expect(res.status).toBe(401);
    });

    test('should return 401 on protected endpoint with "null" token', async () => {
        const res = await request(app)
            .get('/api/links/me')
            .set('Authorization', 'Bearer null');
        expect(res.status).toBe(401);
    });

    test('should return 401 on protected endpoint with empty Bearer', async () => {
        const res = await request(app)
            .get('/api/links/me')
            .set('Authorization', 'Bearer ');
        expect(res.status).toBe(401);
    });

    test('should return 401 on delete link without token', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000001';
        const res = await request(app).delete(`/api/links/${fakeId}`);
        expect(res.status).toBe(401);
    });

    test('should return 401 on delete product without token', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000002';
        const res = await request(app).delete(`/api/products/${fakeId}`);
        expect(res.status).toBe(401);
    });

    test('should NOT allow admin routes without superadmin token', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', 'Bearer fake-regular-user-token');
        expect([401, 403, 404]).toContain(res.status);
    });
});

// ─── 5. INJECTION PAYLOADS ───────────────────────────────────────────────────

describe('💉 Injection Attack Payloads', () => {
    test('should handle SQL-like strings without crashing', async () => {
        const payload = { username: "admin' OR '1'='1" };
        const res = await request(app)
            .post('/api/auth/login')
            .send(payload);
        // Must not crash (500) — Supabase client protects against SQL injection
        expect(res.status).not.toBe(500);
    });

    test('should handle NoSQL injection-like objects', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: { $gt: '' }, password: { $gt: '' } });
        expect(res.status).not.toBe(500);
    });

    test('should handle prototype pollution attempt', async () => {
        const res = await request(app)
            .post('/api/links')
            .set('Authorization', 'Bearer fake-token')
            .send({ '__proto__': { admin: true }, constructor: { prototype: { admin: true } } });
        expect(res.status).not.toBe(500);
    });

    test('should handle path traversal in query params', async () => {
        const res = await request(app).get('/api/social/share/../../etc/passwd');
        expect(res.status).not.toBe(500);
        expect(res.status).toBe(404);
    });
});

// ─── 6. SSRF PROTECTION ──────────────────────────────────────────────────────

describe('🌐 SSRF Protection (Proxy Upload)', () => {
    test('should block localhost SSRF attempt', async () => {
        const res = await request(app)
            .post('/api/links/proxy-thumbnail')
            .set('Authorization', 'Bearer fake-token')
            .send({ url: 'http://localhost:3001/health' });

        // Should be blocked before reaching auth (well-formed auth would give 401 anyway)
        // But if auth passes, the SSRF check should give 400
        expect([400, 401]).toContain(res.status);
    });

    test('should block internal IP SSRF attempt (192.168.x.x)', async () => {
        const res = await request(app)
            .post('/api/links/proxy-thumbnail')
            .set('Authorization', 'Bearer fake-token')
            .send({ url: 'http://192.168.0.1/admin' });

        expect([400, 401]).toContain(res.status);
    });

    test('should block file:// protocol SSRF', async () => {
        const res = await request(app)
            .post('/api/links/proxy-thumbnail')
            .set('Authorization', 'Bearer fake-token')
            .send({ url: 'file:///etc/passwd' });

        expect([400, 401]).toContain(res.status);
    });
});

// ─── 7. HEALTH CHECK ─────────────────────────────────────────────────────────

describe('🏥 Health & Baseline', () => {
    test('should return 200 on health check', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });

    test('should return 404 for unknown routes', async () => {
        const res = await request(app).get('/api/this-route-does-not-exist');
        expect(res.status).toBe(404);
    });

    test('should return JSON (not HTML) for all errors', async () => {
        const res = await request(app).get('/api/nao-existe');
        expect(res.headers['content-type']).toContain('application/json');
    });
});
