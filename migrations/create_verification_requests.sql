-- ============================================================
-- Tabela: verification_requests
-- Rodando no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS verification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT,

    -- Passo 1: Informações da Conta
    nodus_link TEXT NOT NULL,
    display_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,

    -- Passo 2: Categoria
    category TEXT NOT NULL,

    -- Passo 3: Presença Digital
    social_link_1 TEXT NOT NULL,
    social_link_2 TEXT,
    social_link_3 TEXT,
    has_verified_badge BOOLEAN DEFAULT FALSE,

    -- Passo 4: Relevância e Imprensa
    press_link_1 TEXT,
    press_link_2 TEXT,
    press_link_3 TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS idx_verification_requests_user_id ON verification_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests(status);
