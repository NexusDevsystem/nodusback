import { Response, Request } from 'express';
import { linkService } from '../services/linkService.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { ssrfFetch, SsrfError } from '../utils/ssrfGuard.js';

// Ensure uploads directory exists - Note: link thumbnails are stored separately
// so they don't clutter the user's main file manager.
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads/links');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure Multer Storage for Thumbnails
const storage = multer.memoryStorage();

export const uploadThumbnailMiddleware = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for thumbnails
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed for thumbnails'));
        }
    }
});

export const linkController = {
    // Get all links for authenticated user
    async getMyLinks(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const links = await linkService.getLinksByProfileId(req.profileId);
            res.json(links);
        } catch (error) {
            console.error('Error fetching links:', error);
            res.status(500).json({ error: 'Failed to fetch links' });
        }
    },

    // Get links by username (public access)
    async getLinksByUsername(req: AuthRequest, res: Response) {
        try {
            const { username } = req.params;
            const links = await linkService.getLinksByUsername(username);
            res.json(links);
        } catch (error) {
            console.error('Error fetching links:', error);
            res.status(500).json({ error: 'Failed to fetch links' });
        }
    },

    // Create a new link
    async createLink(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const link = await linkService.createLink(req.profileId, req.body);

            if (!link) {
                return res.status(500).json({ error: 'Failed to create link' });
            }

            res.status(201).json(link);
        } catch (error: any) {
            // Surface SSRF validation errors as 400 (not 500)
            if (error?.status === 400 || error?.code?.startsWith('SSRF')) {
                return res.status(400).json({ error: error.message, code: error.code });
            }
            console.error('Error creating link:', error);
            res.status(500).json({ error: 'Failed to create link' });
        }
    },

    // Update a link
    async updateLink(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const link = await linkService.updateLink(id, req.body);
            res.json(link);
        } catch (error) {
            console.error('Error updating link:', error);
            res.status(500).json({ error: 'Failed to update link' });
        }
    },

    // Delete a link
    async deleteLink(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }


            const deleted = await linkService.deleteLink(id);
            res.status(204).send();
        } catch (error) {
            console.error('Error deleting link:', error);
            res.status(500).json({ error: 'Failed to delete link' });
        }
    },

    // Replace all links (bulk update)
    async replaceAllLinks(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { links } = req.body;
            if (!Array.isArray(links)) {
                return res.status(400).json({ error: 'Invalid request: links must be an array' });
            }

            const savedLinks = await linkService.replaceAllLinks(req.profileId, links);

            // ── ONBOARDING: Track first link ────────────────────────────────
            const activeLinks = savedLinks.filter((l: any) => l.isActive !== false);
            const hasFirstLink = activeLinks.length > 0;

            supabase
                .from('users')
                .update({ has_first_link: hasFirstLink })
                .eq('id', req.profileId)
                .then(({ error }) => {
                    if (error) console.error('[Onboarding] Failed to update has_first_link:', error.message);
                });
            // ────────────────────────────────────────────────────────────────

            res.json(savedLinks);
        } catch (error: any) {
            // Surface SSRF validation errors as 400 (not 500)
            if (error?.status === 400 || error?.code?.startsWith('SSRF')) {
                return res.status(400).json({ error: error.message, code: error.code });
            }
            console.error('Error replacing links:', error);
            res.status(500).json({ error: 'Failed to replace links' });
        }
    },

    // Track click
    async trackClick(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            await linkService.incrementClicks(id);
            res.status(204).send();
        } catch (error) {
            console.error('Error tracking click:', error);
            res.status(500).json({ error: 'Failed to track click' });
        }
    },

    // Upload thumbnail (hidden from general file manager)
    async uploadThumbnail(req: AuthRequest, res: Response) {
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            // 🕵️ VALIDATE MAGIC BYTES (MIME Type Sniffing)
            // Inspect the real file content, not just the extension or browser header
            const realType = await fileTypeFromBuffer(file.buffer);
            if (!realType || !realType.mime.startsWith('image/')) {
                console.warn(`🚨 [SECURITY] Blocked suspicious file upload from user ${req.profileId}: ${file.originalname} (Detected: ${realType?.mime || 'unknown'})`);
                return res.status(400).json({ 
                    error: 'Upload de arquivo inválido. O conteúdo do arquivo deve ser uma imagem válida.' 
                });
            }

            // Also check for executable-like mime types explicitly
            const dangerousMimes = ['application/x-executable', 'application/x-msdownload', 'text/html', 'application/javascript'];
            if (dangerousMimes.includes(realType.mime)) {
                 return res.status(400).json({ error: 'Formato de arquivo perigoso bloqueado.' });
            }

            const userId = req.userId;
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `thumb-${name}-${uniqueSuffix}${ext}`;
            const filePath = `${userId}/thumbnails/${filename}`;

            const { data, error } = await supabase.storage
                .from('uploads')
                .upload(filePath, file.buffer!, {
                    contentType: file.mimetype,
                    upsert: false
                });

            if (error) {
                console.error("Supabase Storage Error:", error);
                throw error;
            }

            const { data: publicData } = supabase.storage
                .from('uploads')
                .getPublicUrl(filePath);

            res.json({
                success: true,
                file: {
                    url: publicData.publicUrl,
                    filename: filename
                }
            });
        } catch (error: any) {
            console.error('Thumbnail upload error:', error);
            res.status(500).json({ error: 'Error uploading thumbnail' });
        }
    },

    // 🌐 Proxy upload: Download an external image and save to our Supabase Storage
    async proxyUpload(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { url } = req.body;
            if (!url) {
                return res.status(400).json({ error: 'URL is required' });
            }

            // 🔐 SSRF PROTECTION: resolve DNS + block all private/reserved IP ranges
            // Uses the central ssrfGuard utility — revalidates IP on every redirect.
            let response: globalThis.Response;
            try {
                const result = await ssrfFetch(url, {
                    timeout: 5000,
                    maxRedirects: 3,
                });
                response = result.response;
            } catch (e) {
                if (e instanceof SsrfError) {
                    console.warn(`🔐 [SSRF] Blocked proxy-upload attempt to: ${url} — ${e.message}`);
                    return res.status(400).json({ error: e.message, code: e.code });
                }
                throw e;
            }

            // 1. Read the response as a buffer (max 5 MB)
            const MAX_BYTES = 5 * 1024 * 1024;
            const reader = response.body?.getReader();
            if (!reader) {
                return res.status(502).json({ error: 'Empty response from external URL' });
            }
            const chunks: Uint8Array[] = [];
            let totalBytes = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalBytes += value.length;
                if (totalBytes > MAX_BYTES) {
                    return res.status(413).json({ error: 'Imagem excede 5 MB.' });
                }
                chunks.push(value);
            }
            const buffer = Buffer.concat(chunks);
            const contentType = response.headers.get('content-type') || 'image/jpeg';

            // 2. Generate filename
            const extension = contentType.split('/')[1] || 'jpg';
            const timestamp = Date.now();
            const filename = `proxy-${timestamp}.${extension}`;
            const filePath = `${req.profileId}/thumbnails/${filename}`;

            // 3. Upload to Supabase
            const { error: storageError } = await supabase.storage
                .from('uploads')
                .upload(filePath, buffer, {
                    contentType: contentType,
                    upsert: false
                });

            if (storageError) {
                console.error("Supabase Storage Error (Proxy):", storageError);
                throw storageError;
            }

            const { data: publicData } = supabase.storage
                .from('uploads')
                .getPublicUrl(filePath);

            res.json({
                success: true,
                file: {
                    url: publicData.publicUrl,
                    filename: filename
                }
            });
        } catch (error: any) {
            console.error('Proxy upload error:', error);
            res.status(500).json({ error: 'Error processing external image' });
        }
    },

    // 🔐 Verify password for a password-protected link
    // Public route — no auth required, but only returns URL if password is correct
    async verifyLinkPassword(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { password } = req.body;

            if (!password) {
                return res.status(400).json({ error: 'Senha não informada' });
            }

            // Fetch the link directly from the database
            const { data: link, error } = await supabase
                .from('links')
                .select('id, url, is_password_protected, password_hash')
                .eq('id', id)
                .single();

            if (error || !link) {
                return res.status(404).json({ error: 'Link não encontrado' });
            }

            if (!link.is_password_protected || !link.password_hash) {
                return res.status(400).json({ error: 'Este link não está protegido por senha' });
            }

            // Compare SHA-256 hash
            const inputHash = createHash('sha256').update(password).digest('hex');
            if (inputHash !== link.password_hash) {
                return res.status(401).json({ error: 'Senha incorreta' });
            }

            // Password correct — return the URL
            // Also track click
            await linkService.incrementClicks(id).catch(() => { });

            return res.json({ url: link.url });
        } catch (error) {
            console.error('Error verifying link password:', error);
            res.status(500).json({ error: 'Erro ao verificar senha' });
        }
    }
};
