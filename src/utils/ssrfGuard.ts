/**
 * ssrfGuard.ts
 *
 * Utilitário central de proteção contra SSRF (Server-Side Request Forgery).
 *
 * ⚠️  USE ESTE UTILITÁRIO para qualquer requisição HTTP cujo destino seja
 *     determinado (total ou parcialmente) por input do usuário.
 *
 * Proteções implementadas:
 *  1. Bloqueio de schemas não-HTTP(S)
 *  2. Resolução DNS antes da requisição (previne rebinding attacks)
 *  3. Bloqueio de todos os ranges de IP privado/reservado:
 *       - 127.0.0.0/8   (loopback)
 *       - 10.0.0.0/8    (privado)
 *       - 172.16.0.0/12 (privado)
 *       - 192.168.0.0/16 (privado)
 *       - 169.254.0.0/16 (link-local / AWS metadata endpoint)
 *       - 0.0.0.0/8     (reservado)
 *       - ::1            (IPv6 loopback)
 *       - fc00::/7       (IPv6 privado / ULA)
 *  4. Sem seguimento automático de redirects — revalida o IP em cada salto
 *  5. Timeout máximo de 5 segundos por requisição
 *  6. Mensagem de erro clara e padronizada para o chamador
 */

import dns from 'dns/promises';
import net from 'net';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export class SsrfError extends Error {
    constructor(
        message: string,
        /** Código curto para o chamador diferenciar erros de SSRF vs outros */
        public readonly code: 'SSRF_BLOCKED' | 'SSRF_INVALID_URL' | 'SSRF_INVALID_SCHEMA',
    ) {
        super(message);
        this.name = 'SsrfError';
    }
}

export interface SsrfFetchOptions extends Omit<RequestInit, 'redirect'> {
    /** Timeout em ms. Padrão: 5000 */
    timeout?: number;
    /** Máximo de redirects a seguir (cada IP é revalidado). Padrão: 3 */
    maxRedirects?: number;
}

export interface SsrfFetchResult {
    response: Response;
    /** URL final após todos os redirects */
    finalUrl: string;
}

// ---------------------------------------------------------------------------
// Constantes de ranges bloqueados
// ---------------------------------------------------------------------------

/** Ranges IPv4 privados/reservados como [início, fim] em notação numérica */
const BLOCKED_RANGES_V4: Array<[number, number]> = [
    // 127.0.0.0/8 — loopback
    [ipToLong('127.0.0.0'), ipToLong('127.255.255.255')],
    // 10.0.0.0/8 — RFC 1918
    [ipToLong('10.0.0.0'), ipToLong('10.255.255.255')],
    // 172.16.0.0/12 — RFC 1918
    [ipToLong('172.16.0.0'), ipToLong('172.31.255.255')],
    // 192.168.0.0/16 — RFC 1918
    [ipToLong('192.168.0.0'), ipToLong('192.168.255.255')],
    // 169.254.0.0/16 — link-local / AWS metadata (169.254.169.254)
    [ipToLong('169.254.0.0'), ipToLong('169.254.255.255')],
    // 0.0.0.0/8 — reservado
    [ipToLong('0.0.0.0'), ipToLong('0.255.255.255')],
    // 100.64.0.0/10 — CGNAT / shared address space (RFC 6598)
    [ipToLong('100.64.0.0'), ipToLong('100.127.255.255')],
    // 198.18.0.0/15 — benchmark testing
    [ipToLong('198.18.0.0'), ipToLong('198.19.255.255')],
    // 198.51.100.0/24 — documentação
    [ipToLong('198.51.100.0'), ipToLong('198.51.100.255')],
    // 203.0.113.0/24 — documentação
    [ipToLong('203.0.113.0'), ipToLong('203.0.113.255')],
    // 240.0.0.0/4 — reservado
    [ipToLong('240.0.0.0'), ipToLong('255.255.255.255')],
];

// ---------------------------------------------------------------------------
// Funções auxiliares
// ---------------------------------------------------------------------------

/** Converte um IP v4 string para uint32 */
function ipToLong(ip: string): number {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

/** Verifica se um IP v4 está em algum range bloqueado */
function isBlockedV4(ip: string): boolean {
    if (!net.isIPv4(ip)) return false;
    const n = ipToLong(ip);
    return BLOCKED_RANGES_V4.some(([start, end]) => n >= start && n <= end);
}

/** Verifica se um IP v6 está nos ranges bloqueados */
function isBlockedV6(ip: string): boolean {
    if (!net.isIPv6(ip)) return false;
    // Normaliza (remove brackets se presentes)
    const normalized = ip.replace(/^\[|\]$/g, '').toLowerCase();

    // ::1 — loopback
    if (normalized === '::1') return true;

    // ::ffff:x.x.x.x — IPv4-mapped IPv6 (bypass comum)
    const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4Mapped) return isBlockedV4(ipv4Mapped[1]);

    // fc00::/7 — Unique Local Addresses (ULA) — inclui fd00::/8
    // Os dois primeiros bits de fc/fd são 1111 110x
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

    // fe80::/10 — link-local
    if (normalized.startsWith('fe80:') || normalized.startsWith('fe9') ||
        normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

    return false;
}

/**
 * Resolve o hostname via DNS e verifica se o IP resultante está bloqueado.
 * Lança SsrfError se o hostname resolver para um IP privado/reservado.
 */
export async function validateHostname(hostname: string): Promise<void> {
    // Rejeita hostnames que são diretamente IPs privados
    if (net.isIPv4(hostname)) {
        if (isBlockedV4(hostname)) {
            throw new SsrfError(
                `Acesso bloqueado: o endereço ${hostname} é privado ou reservado.`,
                'SSRF_BLOCKED',
            );
        }
        return;
    }

    if (net.isIPv6(hostname)) {
        if (isBlockedV6(hostname)) {
            throw new SsrfError(
                `Acesso bloqueado: o endereço IPv6 ${hostname} é privado ou reservado.`,
                'SSRF_BLOCKED',
            );
        }
        return;
    }

    // Resolução DNS para hostnames
    let addresses: string[];
    try {
        addresses = await dns.resolve(hostname);
    } catch {
        // Se o DNS falhar (NXDOMAIN, timeout), não tenta — lance o erro original para o chamador
        throw new SsrfError(
            `Não foi possível resolver o hostname: ${hostname}`,
            'SSRF_BLOCKED',
        );
    }

    for (const addr of addresses) {
        if (isBlockedV4(addr) || isBlockedV6(addr)) {
            throw new SsrfError(
                `Acesso bloqueado: ${hostname} resolveu para o IP privado ${addr}.`,
                'SSRF_BLOCKED',
            );
        }
    }
}

/**
 * Valida uma URL fornecida pelo usuário antes de salvar no banco.
 * Rejeita IPs privados já na entrada, antes de qualquer requisição HTTP.
 *
 * Schemas permitidos:
 *  - http: / https:  → valida hostname via DNS (proteção SSRF completa)
 *  - mailto: / tel: / sms: → schemas seguros que não fazem requisição HTTP (sem vetor SSRF)
 *
 * @throws SsrfError se a URL for inválida ou aponte para recurso interno.
 */
export async function validateUserUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new SsrfError(
            'URL inválida. Certifique-se de incluir o protocolo (https://).',
            'SSRF_INVALID_URL',
        );
    }

    // Schemas seguros que não fazem requisição HTTP — sem risco de SSRF.
    // Apenas a abertura no navegador do cliente (mailto abre o e-mail, tel discador, etc.)
    const SAFE_SCHEMAS = ['mailto:', 'tel:', 'sms:'];
    if (SAFE_SCHEMAS.includes(parsed.protocol)) {
        return parsed;
    }

    // Para qualquer outro schema que não seja http/https, bloqueia.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new SsrfError(
            `Protocolo "${parsed.protocol}" não é permitido. Use http://, https://, mailto:, tel: ou sms://.`,
            'SSRF_INVALID_SCHEMA',
        );
    }

    // http/https: resolve DNS e verifica IP
    await validateHostname(parsed.hostname);
    return parsed;
}

/**
 * Faz uma requisição HTTP segura para uma URL fornecida pelo usuário.
 *
 * Diferenças em relação ao `fetch` nativo:
 *  - Valida o IP antes da primeira requisição
 *  - Revalida o IP em cada redirect (previne DNS rebinding e open redirects)
 *  - Rejeita redirects para IPs privados
 *  - Aplica timeout máximo de 5 s por padrão
 *  - Bloqueia schemas não-HTTP(S)
 *
 * @param url     URL de destino (fornecida pelo usuário)
 * @param options Opções padrão do fetch + `timeout` + `maxRedirects`
 */
export async function ssrfFetch(
    url: string,
    options: SsrfFetchOptions = {},
): Promise<SsrfFetchResult> {
    const { timeout = 5000, maxRedirects = 3, ...fetchOptions } = options;

    let currentUrl = url;
    let redirectsLeft = maxRedirects;

    while (true) {
        // 1. Validar URL atual (esquema + IP)
        const parsed = await validateUserUrl(currentUrl);

        // 2. Montar o AbortController para timeout
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        let response: Response;
        try {
            response = await fetch(currentUrl, {
                ...fetchOptions,
                redirect: 'manual', // ← nunca seguir automaticamente
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

        // 3. Sem redirect → retorna
        const isRedirect = response.status >= 300 && response.status < 400;
        if (!isRedirect) {
            return { response, finalUrl: currentUrl };
        }

        // 4. Redirect: verificar se ainda podemos seguir
        if (redirectsLeft <= 0) {
            throw new SsrfError(
                'Número máximo de redirecionamentos atingido.',
                'SSRF_BLOCKED',
            );
        }

        const location = response.headers.get('location');
        if (!location) {
            // Redirect sem Location header — retorna a resposta como está
            return { response, finalUrl: currentUrl };
        }

        // 5. Resolver URL relativa do redirect usando a URL atual como base
        try {
            currentUrl = new URL(location, currentUrl).toString();
        } catch {
            throw new SsrfError(
                `URL de redirecionamento inválida: ${location}`,
                'SSRF_INVALID_URL',
            );
        }

        redirectsLeft--;
        // Volta ao início do loop → revalida o IP do novo destino
    }
}

/**
 * Versão simplificada para usar no lugar de axios/fetch em endpoints
 * que recebem URLs de usuário e precisam apenas do response body.
 *
 * Lança SsrfError se a URL for bloqueada.
 * Lança Error comum para falhas de rede.
 */
export async function safeFetch(
    url: string,
    options: SsrfFetchOptions = {},
): Promise<Response> {
    const { response } = await ssrfFetch(url, options);
    return response;
}
