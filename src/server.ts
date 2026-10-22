import app from './app.js';
import { connectMongo } from './config/mongoClient.js';
import startNotificationWorker from './workers/notificationWorker.js';

const PORT = process.env.PORT || 3001;

async function bootstrap() {
    try {
        await connectMongo();
        app.listen(Number(PORT), '0.0.0.0', () => {
            console.log(`🚀 Nodus Backend API running on port ${PORT}`);
            console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
            console.log(`🌐 Environment: ${process.env.NODE_ENV || 'production'}`);

            // Start background notification worker
            startNotificationWorker();
        });
    } catch (err) {
        console.error('❌ Failed to connect to MongoDB Atlas:', err);
        process.exit(1);
    }
}

bootstrap();
