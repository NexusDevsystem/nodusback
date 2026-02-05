import express from 'express';
import cors from 'cors';
import profileRoutes from './routes/profileRoutes.js';
import linkRoutes from './routes/linkRoutes.js';
import productRoutes from './routes/productRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import leadRoutes from './routes/leadRoutes.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Temporarily allow all origins for debugging
app.use(cors({
    origin: true, // Allow all origins temporarily
    credentials: true,
    optionsSuccessStatus: 200
}));
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images

// Logging middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - Origin: ${req.get('origin')}`);
    next();
});

// Routes
app.use('/api/profile', profileRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/products', productRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/leads', leadRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Nodus Backend API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    if (process.env.RAILWAY_STATIC_URL) {
        console.log(`🌐 Production URL: https://${process.env.RAILWAY_STATIC_URL}`);
    }
});
