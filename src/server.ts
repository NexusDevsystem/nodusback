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

// CORS Configuration - Allow all for now, restrict later if needed
app.use(cors({
    origin: '*', // Allow ALL origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false // Changed to false when using wildcard
}));

app.use(express.json({
    limit: '50mb',
    verify: (req: any, res, buf) => {
        if (req.originalUrl.startsWith('/api/billing/webhook')) {
            req.rawBody = buf;
        }
    }
}));

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

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
        endpoints: ['/health', '/api/profile', '/api/links', '/api/products', '/api/analytics', '/api/leads', '/api/music', '/api/billing']
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Nodus Backend API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});
