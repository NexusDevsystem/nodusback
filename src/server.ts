import app from './app.js';
import startNotificationWorker from './workers/notificationWorker.js';

const PORT = process.env.PORT || 8080;

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Nodus Backend API running on port ${PORT}`);
    console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'production'}`);

    // Start background background checks
    startNotificationWorker();
});
