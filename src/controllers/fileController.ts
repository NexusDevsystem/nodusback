import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '../../uploads/files');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return cb(new Error('User not authenticated'), '');
        }

        const userDir = path.join(UPLOADS_DIR, userId);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        // Sanitize filename: remove special chars, keep extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
});

export const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allowed file types
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only Images, PDFs and Docs are allowed.'));
        }
    }
});

const fileController = {
    // Upload File
    uploadFile: async (req: Request, res: Response) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: true, message: 'No file uploaded' });
            }

            const userId = (req as any).user.id;
            const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
            const fileUrl = `${baseUrl}/uploads/files/${userId}/${req.file.filename}`;

            res.json({
                success: true,
                message: 'File uploaded successfully',
                file: {
                    name: req.file.originalname,
                    filename: req.file.filename,
                    size: req.file.size,
                    url: fileUrl,
                    mimetype: req.file.mimetype,
                    uploadedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            console.error('Upload error:', error);
            res.status(500).json({ error: true, message: 'Error uploading file', details: error.message });
        }
    },

    // List Files
    listFiles: async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user.id;
            const userDir = path.join(UPLOADS_DIR, userId);

            if (!fs.existsSync(userDir)) {
                return res.json({ success: true, files: [] });
            }

            const files = fs.readdirSync(userDir).map(filename => {
                const filePath = path.join(userDir, filename);
                const stats = fs.statSync(filePath);
                const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;

                return {
                    filename,
                    url: `${baseUrl}/uploads/files/${userId}/${filename}`,
                    size: stats.size,
                    uploadedAt: stats.mtime.toISOString()
                };
            });

            // Sort by newest first
            files.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

            res.json({ success: true, files });
        } catch (error: any) {
            console.error('List files error:', error);
            res.status(500).json({ error: true, message: 'Error listing files' });
        }
    },

    // Delete File
    deleteFile: async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user.id;
            const { filename } = req.params;

            // Security check: prevent directory traversal
            const safeFilename = path.basename(filename);
            const userDir = path.join(UPLOADS_DIR, userId);
            const filePath = path.join(userDir, safeFilename);

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                res.json({ success: true, message: 'File deleted successfully' });
            } else {
                res.status(404).json({ error: true, message: 'File not found' });
            }
        } catch (error: any) {
            console.error('Delete file error:', error);
            res.status(500).json({ error: true, message: 'Error deleting file' });
        }
    }
};

export default fileController;
