
/**
 * Checks if a link is incomplete (missing the specific ID/username/number)
 * Replicated from frontend for backend validation consistency
 */
export const isLinkIncomplete = (url: string, platformId?: string): boolean => {
    if (!url || url.trim() === '') return true;

    // Common base URLs that indicate no ID was provided
    const basePaths = [
        'https://wa.me/', 'https://wa.me',
        'https://instagram.com/', 'https://instagram.com',
        'https://facebook.com/', 'https://facebook.com',
        'https://x.com/', 'https://x.com',
        'https://twitter.com/', 'https://twitter.com',
        'https://tiktok.com/@', 'https://tiktok.com/',
        'https://linkedin.com/in/', 'https://linkedin.com/',
        'https://t.me/',
        'https://youtube.com/@', 'https://youtube.com/channel/',
        'https://twitch.tv/',
        'https://kick.com/',
        'mailto:',
        'tel:',
        'https://',
        'http://'
    ];

    const trimmedUrl = url.trim().toLowerCase();
    
    // Exact match with any base path means no content added
    if (basePaths.some(path => trimmedUrl === path)) return true;

    // Special cases
    if (platformId === 'whatsapp' && (trimmedUrl === 'https://wa.me/' || trimmedUrl === 'https://wa.me')) return true;
    if (platformId === 'email' && trimmedUrl === 'mailto:') return true;
    if (platformId === 'telefone' && trimmedUrl === 'tel:') return true;

    return false;
};

/**
 * Capitalizes the first letter of a string
 */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
