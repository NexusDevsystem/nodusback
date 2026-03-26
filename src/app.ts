import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import profileRoutes from './routes/profileRoutes.js';
import linkRoutes from './routes/linkRoutes.js';
import productRoutes from './routes/productRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import musicRoutes from './routes/musicRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import socialRoutes from './routes/socialRoutes.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import blogRoutes from './routes/blogRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import path from 'path';
import { xssMiddleware } from './middleware/xssMiddleware.js';
import { inputLimitMiddleware } from './middleware/inputLimitMiddleware.js';

const app = express();

// Trust proxy for Railway/Proxies (required for express-rate-limit)
app.set('trust proxy', 1);

// 1. CORS Configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:5173').split(',');

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.includes(origin) ||
            origin.includes('localhost') ||
            origin.includes('nodus.my') ||
            origin.includes('nodus.app') ||
            origin.endsWith('.vercel.app');
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`🚫 Blocked CORS request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    maxAge: 86400
}));

// 2. Security Headers (Helmet) & Parameter Pollution (HPP)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    // 🛡️ DEFENSE IN DEPTH: Content-Security-Policy
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    // 🛡️ Strict-Transport-Security (HSTS)
    hsts: {
        maxAge: 31536000,      // 1 year
        includeSubDomains: true,
        preload: true
    },
    // Block MIME-type sniffing
    noSniff: true,
    // Prevent clickjacking
    frameguard: { action: 'deny' },
    // Referrer Policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(hpp());

// 3. Rate Limiting (General)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP'
});

// 🔐 Strict Rate Limiting for Auth (Brute-force protection)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many login attempts, please try again after 15 minutes'
});

// 🔐 Strict Rate Limiting for File Uploads
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 50,                   // max 50 uploads per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Limite de uploads atingido. Tente novamente em 1 hora.'
});

app.use('/api/auth/', authLimiter);
app.use('/api/files/', uploadLimiter);
app.use('/api/links/thumbnail', uploadLimiter);
app.use(limiter);

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Body Parser with Webhook Support
app.use(express.json({
    limit: '10mb',
    verify: (req: any, res, buf) => {
        if (req.originalUrl.includes('/billing/webhook') || req.path.includes('/billing/webhook')) {
            req.rawBody = buf;
        }
    }
}));

// 🛡️ Global Security Layer
app.use(xssMiddleware);       // Sanitize <script> injections
app.use(inputLimitMiddleware); // Enforce text length limits

// Serve Uploads Static Directory
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
app.use('/uploads', express.static(UPLOADS_DIR));

// Routes removed for clean restart
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/products', productRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/billing', billingRoutes); // Removed for restart
app.use('/api/integrations', integrationRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/blog', blogRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ message: 'Nodus Backend API', version: '1.0.0', env: process.env.NODE_ENV || 'development' });
});

// 404 Handler
app.use((req, res) => {
    console.warn(`⚠️ 404 - Not Found: ${req.method} ${req.path}`);
    res.status(404).json({ error: true, message: `Rota ${req.method} ${req.path} não encontrada.`, code: 'ROUTE_NOT_FOUND' });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('❌ ERRO CRÍTICO NO SERVIDOR:', err.message);
    if (err.stack) console.error(err.stack);
    res.status(err.status || 500).json({ error: true, message: err.message || 'Erro Interno do Servidor', path: req.path });
});

export default app;
