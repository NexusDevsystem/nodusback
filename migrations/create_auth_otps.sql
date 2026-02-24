-- Criação da tabela para armazenar códigos de recuperação de senha (OTPs)
CREATE TABLE IF NOT EXISTS public.auth_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_auth_otps_user_id ON public.auth_otps(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_otps_email ON public.auth_otps(email);

-- Configurar RLS (Row Level Security) - Apenas backend pode acessar essa tabela via Service Role ou Bypass RLS
ALTER TABLE public.auth_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Apenas admins (service role) podem ler/escrever otps" ON public.auth_otps
    AS PERMISSIVE FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
