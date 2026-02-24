import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export const sendPasswordResetEmail = async (to: string, code: string, name: string) => {
    try {
        const serviceId = process.env.EMAILJS_SERVICE_ID;
        const templateId = process.env.EMAILJS_TEMPLATE_ID;
        const publicKey = process.env.EMAILJS_PUBLIC_KEY;
        const privateKey = process.env.EMAILJS_PRIVATE_KEY; // EmailJS Private Key for API calls

        if (!serviceId || !templateId || !publicKey || !privateKey) {
            console.warn('⚠️ [EmailJS] Missing credentials in .env. Skipping actual email send. Code:', code);
            console.log(`🔑 [DEBUG] OTP for ${to}: ${code}`);
            return true; // Simulate success for dev
        }

        const data = {
            service_id: serviceId,
            template_id: templateId,
            user_id: publicKey,
            accessToken: privateKey,
            template_params: {
                user_name: name,
                otp_code: code,
                to_email: to,
                reply_to: 'contato@nodus.my'
            }
        };

        await axios.post('https://api.emailjs.com/api/v1.0/email/send', data, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`✅ [EmailJS] Password reset sent to ${to}`);
        return true;
    } catch (error: any) {
        console.error('❌ [EmailJS] Failed to send password reset:', error.response?.data || error.message);
        return false;
    }
};
