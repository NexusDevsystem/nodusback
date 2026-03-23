import { Request, Response, NextFunction } from 'express';
import xss from 'xss';

/**
 * 🛡️ XSS PROTECTION MIDDLEWARE
 * Recursively cleans all strings in the request body, query and params.
 * Prevents malicious script injection (<script>, onerror, etc.)
 */
const clean = (data: any): any => {
    if (typeof data === 'string') {
        return xss(data);
    }
    
    if (Array.isArray(data)) {
        return data.map(item => clean(item));
    }
    
    if (typeof data === 'object' && data !== null) {
        const cleaned: any = {};
        for (const key in data) {
            // Keep buffers and raw body as-is
            if (key === 'buffer' || key === 'rawBody' || key === 'file') {
                cleaned[key] = data[key];
                continue;
            }
            cleaned[key] = clean(data[key]);
        }
        return cleaned;
    }
    
    return data;
};

export const xssMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (req.body) req.body = clean(req.body);
    if (req.query) req.query = clean(req.query);
    if (req.params) req.params = clean(req.params);
    
    next();
};
