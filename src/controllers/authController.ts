import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabaseClient.js';

const JWT_SECRET = process.env.JWT_SECRET || 'nodus_super_secret_jwt_key_change_in_production';
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
