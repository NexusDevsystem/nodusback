import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { supabase } from '../config/supabaseClient.js';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import axios from 'axios';


// Extend Express Request interface to include user and file
interface MulterRequest extends Request {
    file?: Express.Multer.File;
    user?: any;
}

// Ensure uploads directory exists
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads/files');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure Multer Storage (Using Memory Storage for direct upload to Supabase)
const storage = multer.memoryStorage();

export const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
        // Allowed file types
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'video/mp4', 'video/webm'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only Images, Videos, PDFs and Docs are allowed.'));
        }
    }
});

const fileController = {
    // Upload File
    uploadFile: async (req: Request, res: Response) => {
        try {
            const multerReq = req as MulterRequest;

            if (!multerReq.file) {
                return res.status(400).json({ error: true, message: 'No file uploaded' });
            }

            // 🕵️ VALIDATE MAGIC BYTES (MIME Type Sniffing)
            const realType = await fileTypeFromBuffer(multerReq.file.buffer);

            // Only validate if detection is possible (text/svg/etc might return undefined)
            if (realType) {
                const allowedMimeGroups = ['image/', 'video/', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument'];
                const isRealAllowed = allowedMimeGroups.some(group => realType.mime.startsWith(group));

                if (!isRealAllowed) {
                    console.warn(`🚨 [SECURITY] Blocked malicious upload attempt from user ${(req as any).profileId}: ${multerReq.file.originalname} (Detected real type: ${realType.mime})`);
                    return res.status(400).json({ error: true, message: 'O conteúdo do arquivo não condiz com as extensões suportadas.' });
                }
            }

            const userId = (req as any).userId;

            // 🖼️ IMAGE CONVERSION: PNG/WebP/etc -> Optimized JPEG
            let buffer = multerReq.file.buffer;
            let mimetype = multerReq.file.mimetype;
            let originalExt = path.extname(multerReq.file.originalname).toLowerCase();
            let finalExt = originalExt;

            if (mimetype.startsWith('image/') && !mimetype.includes('svg')) {
                try {
                    buffer = await sharp(buffer)
                        .jpeg({ quality: 85, mozjpeg: true })
                        .toBuffer();
                    mimetype = 'image/jpeg';
                    finalExt = '.jpg';
                } catch (err) {
                    console.error('Sharp processing error:', err);
                    // Fallback to original if processing fails
                }
            }

            // Generate a unique SHORT filename to avoid giant URLs
            const shortId = Math.random().toString(36).substring(2, 7); // 5 random chars
            const baseName = path.basename(multerReq.file.originalname, originalExt)
                .substring(0, 12) // Limit original name length to 12 chars
                .replace(/[^a-zA-Z0-9]/g, '_');
            
            const fileName = `${baseName}-${shortId}${finalExt}`;
            const folder = (req.query.folder as string) || '';
            const type = (req.query.type as string) || 'user_upload';
            const storageFolder = folder ? `${folder}/` : '';
            const filePath = `${userId}/${storageFolder}${fileName}`;

            // Upload to Supabase Storage
            const { data, error } = await supabase.storage
                .from('uploads')
                .upload(filePath, buffer, {
                    contentType: mimetype,
                    cacheControl: '31536000',
                    upsert: false
                });


            if (error) {
                console.error('Supabase storage upload error:', error);
                throw new Error('Failed to upload file to cloud storage');
            }

            // Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('uploads')
                .getPublicUrl(filePath);

            // Register asset in database for permanent tracking and precise filtering
            // We now store the DIRECT Supabase public URL to ensure absolute reliability
            await supabase
                .from('blog_assets')
                .insert({
                    user_id: (req as any).profileId,
                    filename: fileName,
                    url: publicUrl,
                    mimetype: mimetype,
                    size: buffer.length,
                    asset_type: type
                });

            res.json({
                success: true,
                message: 'File uploaded successfully',
                file: {
                    name: multerReq.file.originalname,
                    filename: fileName,
                    size: buffer.length,
                    url: publicUrl,
                    cloudUrl: publicUrl,
                    mimetype: mimetype,
                    uploadedAt: new Date().toISOString()
                }
            });

        } catch (error: any) {
            console.error('Upload error:', error);
            const status = error.message?.includes('Invalid file type') ? 400 : 500;
            res.status(status).json({ error: true, message: error.message || 'Error uploading file' });
        }
    },

    listFiles: async (req: Request, res: Response) => {
        try {
            const profileId = (req as any).profileId;

            // 🔥 CRITICAL: Don't list from storage anymore! 
            // Query only assets registered in the DB as 'user_upload'
            // This ensures total isolation for the File Manager.
            const { data: dbFiles, error } = await supabase
                .from('blog_assets')
                .select('*')
                .eq('user_id', profileId)
                .eq('asset_type', 'user_upload')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formattedFiles = dbFiles?.map(f => ({
                ...f,
                url: f.url, // Directly use stored public URL
                cloudUrl: f.url,
                uploadedAt: f.created_at
            })) || [];

            res.json({ success: true, files: formattedFiles });
        } catch (error: any) {
            console.error('List files error:', error);
            res.status(500).json({ error: true, message: 'Error listing files' });
        }
    },

    // Delete File
    deleteFile: async (req: Request, res: Response) => {
        try {
            const profileId = (req as any).profileId;
            const { filename } = req.params;

            // Get basic file info from URL/filename in storage relative to user root
            // Security: We get file by filename and user_id to ensure ownership
            const { data: fileRecord, error: fetchErr } = await supabase
                .from('blog_assets')
                .select('url, asset_type')
                .eq('filename', filename)
                .eq('user_id', profileId)
                .single();

            if (fetchErr || !fileRecord) {
                return res.status(404).json({ error: true, message: 'File not found' });
            }

            // Path construction depends on asset type (blog assets are in a subfolder)
            const storageFolder = fileRecord.asset_type === 'blog' ? 'blog/' : '';
            const filePath = `${profileId}/${storageFolder}${filename}`;

            // 1. Delete from Supabase Storage
            const { error: storageErr } = await supabase.storage
                .from('uploads')
                .remove([filePath]);

            if (storageErr) throw storageErr;

            // 2. Remove from database tracking
            await supabase
                .from('blog_assets')
                .delete()
                .eq('filename', filename)
                .eq('user_id', profileId);

            res.json({ success: true, message: 'File deleted successfully' });
        } catch (error: any) {
            console.error('Delete file error:', error);
            res.status(500).json({ error: true, message: 'Error deleting file' });
        }
    },

    // Public: Sync generated share card image.
    syncBlogCard: async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            const { image } = req.body; // base64 dataUrl

            if (!slug || !image) return res.status(400).json({ error: 'Missing data' });

            const profileId = (req as any).profileId;
            const { data: post } = await supabase
                .from('blog_posts')
                .select('id, user_id')
                .eq('slug', slug)
                .single();

            if (!post) return res.status(404).json({ error: 'Post not found' });

            // 🔐 Ownership Check
            if (post.user_id !== profileId) {
                return res.status(403).json({ error: 'Acesso negado. Você não é o autor deste post.' });
            }

            const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
            const rawBuffer = Buffer.from(base64Data, 'base64');

            // Convert card to optimized JPEG
            const buffer = await sharp(rawBuffer).jpeg({ quality: 90 }).toBuffer();
            const fileName = `blog-cards/${slug}.jpg`;

            const { error: uploadError } = await supabase.storage
                .from('uploads')
                .upload(fileName, buffer, {
                    contentType: 'image/jpeg',
                    upsert: true
                });


            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(fileName);
            res.json({ success: true, url: publicUrl });
        } catch (error: any) {
            console.error('Sync blog card error:', error);
            res.status(500).json({ error: true, message: error.message });
        }
    },

    // Public: Sync generated profile share card image.
    syncProfileCard: async (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const { image } = req.body; // base64 dataUrl

            if (!username || !image) return res.status(400).json({ error: 'Missing data' });

            // 🔐 Ownership Check
            const profileId = (req as any).profileId;
            const { data: profile } = await supabase.from('users').select('id, username').eq('id', profileId).single();

            if (!profile || (profile.username !== username && (req as any).role !== 'superadmin')) {
                return res.status(403).json({ error: 'Acesso negado. Você só pode sincronizar seu próprio perfil.' });
            }

            const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
            const rawBuffer = Buffer.from(base64Data, 'base64');

            // Convert profile card to optimized JPEG
            const buffer = await sharp(rawBuffer).jpeg({ quality: 90 }).toBuffer();
            const fileName = `profile-cards/${username}.jpg`;

            const { error: uploadError } = await supabase.storage
                .from('uploads')
                .upload(fileName, buffer, {
                    contentType: 'image/jpeg',
                    upsert: true
                });


            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(fileName);
            res.json({ success: true, url: publicUrl });
        } catch (error: any) {
            console.error('Sync profile card error:', error);
            res.status(500).json({ error: true, message: error.message });
        }
    },

    // Public: Proxy-serve file content from cloud storage
    // Public: Redirect to cloud storage
    getFileRedirect: async (req: Request, res: Response) => {
        try {
            const filename = req.params.filename || (req.params as any)[0];

            // Security: Use filename to look up identity and type
            // Note: We don't use 'url' from DB anymore because it's now the branded one.
            // We reconstruct the cloud URL on the fly.
            const { data: asset, error } = await supabase
                .from('blog_assets')
                .select('user_id, asset_type, mimetype')
                .eq('filename', filename)
                .single();

            if (error || !asset) {
                console.warn(`⚠️ [REDIRECT] File not found or error: ${filename}`);
                return res.status(404).send(`
                    <div style="font-family:sans-serif; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; background:#fff; color:#000;">
                        <h1 style="font-weight:900; text-transform:uppercase; letter-spacing:0.2em; font-size:12px; margin-bottom:20px;">Nodus Link</h1>
                        <p style="font-weight:700; text-transform:uppercase; letter-spacing:0.1em; font-size:10px; color:#999;">Arquivo não encontrado ou removido no sistema Nodus.</p>
                        <a href="https://nodus.my" style="margin-top:40px; color:#000; text-decoration:underline; font-size:10px; font-weight:900; text-transform:uppercase;">Voltar ao Início</a>
                    </div>
                `);
            }

            // Reconstruct the original Supabase Cloud URl
            const storageFolder = asset.asset_type === 'blog' ? 'blog/' : '';
            const supabaseUrl = process.env.SUPABASE_URL || 'https://gadqvlcijsmgtbwydvay.supabase.co';
            const cloudUrl = `${supabaseUrl}/storage/v1/object/public/uploads/${asset.user_id}/${storageFolder}${filename}`;

            // Perform 302 redirect to original cloud storage URL (fastest and most reliable)
            return res.redirect(cloudUrl);
        } catch (error: any) {
            console.error('File redirect error:', error);
            res.status(500).send('Erro interno ao processar o arquivo no sistema Nodus.');
        }
    }
};

export default fileController;
