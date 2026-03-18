import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { supabase } from '../config/supabaseClient.js';

// Extend Express Request interface to include user and file
interface MulterRequest extends Request {
    file?: Express.Multer.File;
    user?: any;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '../../uploads/files');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure Multer Storage (Using Memory Storage for direct upload to Supabase)
const storage = multer.memoryStorage();

export const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
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

            const userId = (req as any).userId;
            
            // Generate a unique filename to avoid collisions
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(multerReq.file.originalname);
            const name = path.basename(multerReq.file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
            const fileName = `${name}-${uniqueSuffix}${ext}`;
            const folder = (req.query.folder as string) || '';
            const type = (req.query.type as string) || 'user_upload';
            const storageFolder = folder ? `${folder}/` : '';
            const filePath = `${userId}/${storageFolder}${fileName}`;

            // Upload to Supabase Storage
            const { data, error } = await supabase.storage
                .from('uploads')
                .upload(filePath, multerReq.file.buffer, {
                    contentType: multerReq.file.mimetype,
                    cacheControl: '3600',
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
            await supabase
                .from('blog_assets')
                .insert({
                    user_id: (req as any).profileId, // Using profileId for consistency with other parts of system
                    filename: fileName,
                    url: publicUrl,
                    mimetype: multerReq.file.mimetype,
                    size: multerReq.file.size,
                    asset_type: type
                });

            res.json({
                success: true,
                message: 'File uploaded successfully',
                file: {
                    name: multerReq.file.originalname,
                    filename: fileName,
                    size: multerReq.file.size,
                    url: publicUrl,
                    mimetype: multerReq.file.mimetype,
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

            res.json({ success: true, files: dbFiles || [] });
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
    }
};

export default fileController;
