import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import profileRoutes from './routes/profileRoutes.js';
import linkRoutes from './routes/linkRoutes.js';
import productRoutes from './routes/productRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import musicRoutes from './routes/musicRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';

const app = express();
const PORT = process.env.PORT || 3001;

console.log('🚀 Starting Nodus Backend initialized at:', new Date().toISOString());

// 1. CORS Configuration (MUST BE FIRST)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
}));

// 2. Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// 2. Body Parser with Webhook Support
app.use(express.json({
    limit: '50mb',
    verify: (req: any, res, buf) => {
        // Stripe Webhook needs the raw body
        if (req.originalUrl.includes('/billing/webhook') || req.path.includes('/billing/webhook')) {
            req.rawBody = buf;
        }
    }
}));

// Routes
app.use('/api/profile', profileRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/products', productRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/integrations', integrationRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Nodus Backend API',
        version: '1.0.0',
        env: process.env.NODE_ENV || 'development'
    });
});

// 404 HANDLER - Catch all unmatched routes
app.use((req, res) => {
    console.warn(`⚠️ 404 - Not Found: ${req.method} ${req.path}`);
    res.status(404).json({
        error: true,
        message: `Rota ${req.method} ${req.path} não encontrada no Servidor Nodus.`,
        code: 'ROUTE_NOT_FOUND'
    });
});

// GLOBAL ERROR HANDLER - Must be last
// Ensures all errors return JSON instead of HTML to prevent frontend crashes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('❌ ERRO CRÍTICO NO SERVIDOR:', err.message);
    if (err.stack) console.error(err.stack);

    // Safety check to avoid sending HTML even on crash
    res.status(err.status || 500).json({
        error: true,
        message: err.message || 'Erro Interno do Servidor',
        path: req.path
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Nodus Backend API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});
