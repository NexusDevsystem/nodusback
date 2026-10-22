import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI not defined in environment variables.');
}

let isConnected = false;

export async function connectMongo(): Promise<typeof mongoose> {
    if (isConnected && mongoose.connection.readyState === 1) {
        return mongoose;
    }

    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI is required to connect to MongoDB.');
    }

    try {
        const conn = await mongoose.connect(MONGODB_URI, {
            autoIndex: true,
        });
        isConnected = true;
        console.log(`✅ Conectado ao MongoDB Atlas com sucesso! Banco: ${conn.connection.name}`);
        return conn;
    } catch (error) {
        console.error('❌ Erro ao conectar ao MongoDB:', error);
        throw error;
    }
}

export { mongoose };
