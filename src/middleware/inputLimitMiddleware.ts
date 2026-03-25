import { Request, Response, NextFunction } from 'express';

/**
 * 📏 INPUT LIMIT MIDDLEWARE
 * Prevents "Payload Injection" by limiting the length of any string sent to the server.
 * This is a secondary layer to the global 2MB limit in express.json.
 */
const MAX_STRING_LENGTH = 10000; // 10k chars is plenty for any legitimate Nodus field
const FIELD_LIMITS: Record<string, number> = {
    'url': 2048,           // Standard safe URL length
    'name': 100,           // User/Link name
    'title': 150,          // Product/Post title
    'description': 2000,   // Bio/Product description
    'username': 30,        // Max username length
    'password': 128,       // Max password length
    'slug': 100,           // Blog slugs
    'customCSS': 5000,     // Allow a bit more for CSS but not infinite
    'avatarUrl': 200000,   // Support Base64 avatars
    'image': 200000,       // Support Base64 link images
    'imageUrl': 200000,    // Support Base64 post images
    'customBackground': 500000, // Backgrounds can be larger
};

const validateLimits = (data: any): string | null => {
    if (typeof data !== 'object' || data === null) return null;

    for (const key in data) {
        const value = data[key];

        if (typeof value === 'string') {
            const limit = FIELD_LIMITS[key] || MAX_STRING_LENGTH;
            if (value.length > limit) {
                return `Campo '${key}' excede o limite permitido de ${limit} caracteres.`;
            }
        } else if (typeof value === 'object' && value !== null) {
            // Recursive check for nested objects/arrays
            const error = validateLimits(value);
            if (error) return error;
        }
    }
    return null;
};

export const inputLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Check body strings
    if (req.body) {
        const error = validateLimits(req.body);
        if (error) {
            console.warn(`🚨 [SECURITY] Input limit exceeded: ${error}`);
            return res.status(400).json({ 
                error: true, 
                message: error,
                code: 'INPUT_LIMIT_EXCEEDED'
            });
        }
    }

    next();
};
