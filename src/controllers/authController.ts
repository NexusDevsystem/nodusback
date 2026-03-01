import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabaseClient.js';
import { sendPasswordResetEmail } from '../services/emailService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'nodus_super_secret_jwt_key_change_in_production';
const RESET_SECRET = process.env.RESET_SECRET || 'nodus_reset_secret_key';
const SALT_ROUNDS = 12;

export const register = async (req: Request, res: Response) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
        }

        const sanitizedEmail = email.toLowerCase().trim();

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id, auth_provider')
            .eq('email', sanitizedEmail)
            .maybeSingle();

        if (existingUser) {
            if (existingUser.auth_provider === 'google') {
                return res.status(409).json({ error: 'Este email já está vinculado a uma conta Google. Faça login com o Google.' });
            }
            return res.status(409).json({ error: 'Este email já está cadastrado. Faça login.' });
        }

        // Hash the password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Create the user
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email: sanitizedEmail,
                name: name?.trim() || sanitizedEmail.split('@')[0],
                password_hash: passwordHash,
                auth_provider: 'email',
                onboarding_completed: false,
                tutorial_status: 'no',
                theme_id: 'default',
                font_family: 'Inter'
            })
            .select('id, email, name, onboarding_completed, username')
            .single();

        if (createError) {
            console.error('Error creating user:', createError);
            return res.status(500).json({ error: 'Falha ao criar conta. Tente novamente.' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: newUser.id, email: sanitizedEmail, provider: 'email' },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        console.log(`✅ [Auth] New user registered: ${sanitizedEmail} (ID: ${newUser.id})`);

        return res.status(201).json({
            token,
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                picture: null
            }
        });

    } catch (error: any) {
        console.error('Register error:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
        }

        const sanitizedEmail = email.toLowerCase().trim();

        // Fetch user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, name, password_hash, auth_provider, onboarding_completed, username')
            .eq('email', sanitizedEmail)
            .maybeSingle();

        if (userError) {
            console.error('DB error on login:', userError);
            return res.status(500).json({ error: 'Erro ao verificar credenciais.' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Email ou senha incorretos.' });
        }

        if (user.auth_provider === 'google' || !user.password_hash) {
            return res.status(401).json({ error: 'Esta conta usa login pelo Google. Continue com o botão do Google.' });
        }

        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Email ou senha incorretos.' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: sanitizedEmail, provider: 'email' },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        console.log(`✅ [Auth] User logged in via email: ${sanitizedEmail} (ID: ${user.id})`);

        return res.status(200).json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: null
            }
        });

    } catch (error: any) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

// --- PASSWORD RESET FLOW ---

export const requestPasswordReset = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email é obrigatório.' });

        const sanitizedEmail = email.toLowerCase().trim();

        // Check if user exists and is an email user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, name, auth_provider')
            .eq('email', sanitizedEmail)
            .maybeSingle();

        if (userError || !user) {
            // For security, don't reveal if email exists or not exactly, but here we keep it friendly
            return res.status(404).json({ error: 'Nenhuma conta encontrada com este email.' });
        }

        if (user.auth_provider === 'google') {
            return res.status(400).json({ error: 'Esta conta utiliza login pelo Google.' });
        }

        // Generate 6 digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // Expire in 15 mins
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 15);

        // Invalidate previous OTPs for this user
        await supabase
            .from('auth_otps')
            .update({ used: true })
            .eq('user_id', user.id)
            .eq('used', false);

        // Store new OTP using Service Role (since RLS protects it)
        const { error: insertError } = await supabase
            .from('auth_otps')
            .insert({
                user_id: user.id,
                email: sanitizedEmail,
                code,
                expires_at: expiresAt.toISOString(),
                used: false
            });

        if (insertError) {
            console.error('Failed to insert OTP:', insertError);
            return res.status(500).json({ error: 'Erro ao gerar código de recuperação.' });
        }

        // Send Email
        const emailSent = await sendPasswordResetEmail(sanitizedEmail, code, user.name);

        if (!emailSent) {
            return res.status(500).json({ error: 'Erro ao enviar o e-mail.' });
        }

        return res.status(200).json({ message: 'Código de recuperação enviado.' });

    } catch (error) {
        console.error('requestPasswordReset error:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

export const verifyResetCode = async (req: Request, res: Response) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) return res.status(400).json({ error: 'Email e código são obrigatórios.' });

        const sanitizedEmail = email.toLowerCase().trim();

        // Find active OTP
        const { data: otpRecords, error: otpError } = await supabase
            .from('auth_otps')
            .select('*')
            .eq('email', sanitizedEmail)
            .eq('code', code)
            .eq('used', false)
            .gte('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

        if (otpError || !otpRecords || otpRecords.length === 0) {
            return res.status(400).json({ error: 'Código inválido ou expirado.' });
        }

        const otp = otpRecords[0];

        // Mark OTP as used
        await supabase
            .from('auth_otps')
            .update({ used: true })
            .eq('id', otp.id);

        // Generate a temporary reset token (valid for 15 mins)
        const resetToken = jwt.sign(
            { userId: otp.user_id, email: sanitizedEmail, purpose: 'password_reset' },
            RESET_SECRET,
            { expiresIn: '15m' }
        );

        return res.status(200).json({
            message: 'Código verificado com sucesso.',
            resetToken
        });

    } catch (error) {
        console.error('verifyResetCode error:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

export const resetPassword = async (req: Request, res: Response) => {
    try {
        const { resetToken, newPassword } = req.body;

        if (!resetToken || !newPassword) {
            return res.status(400).json({ error: 'Dados insuficientes para redefinição.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
        }

        // Verify token
        let decoded: any;
        try {
            decoded = jwt.verify(resetToken, RESET_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Sessão de redefinição inválida ou expirada.' });
        }

        if (decoded.purpose !== 'password_reset') {
            return res.status(401).json({ error: 'Token inválido.' });
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Update user
        const { error: updateError } = await supabase
            .from('users')
            .update({ password_hash: passwordHash })
            .eq('id', decoded.userId);

        if (updateError) {
            console.error('Failed to update password:', updateError);
            return res.status(500).json({ error: 'Erro ao salvar a nova senha.' });
        }

        return res.status(200).json({ message: 'Senha redefinida com sucesso. Faça login.' });

    } catch (error) {
        console.error('resetPassword error:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};
