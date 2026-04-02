/**
 * planGuard.ts
 * 
 * SERVER-SIDE plan enforcement for Nodus.
 * 
 * This is the SINGLE SOURCE OF TRUTH for PRO feature gating.
 * The frontend also has `planUtils.ts` for UX purposes (hiding buttons, 
 * preview mode), but the actual save is rejected here if a free user 
 * attempts to persist PRO features through the API.
 * 
 * ⚠️  KEEP IN SYNC with:
 *   - frontend/src/constants.ts (THEMES, FONTS)
 *   - frontend/src/utils/planUtils.ts
 */

// ---------------------------------------------------------------------------
// PRO Theme IDs
// Any themeId NOT in this list is considered free.
// 'custom' is always PRO.
// ---------------------------------------------------------------------------
export const FREE_THEME_IDS = new Set<string>([
    // Artistic
    'artistic-sketchbook',
    // Brutalist
    'brutalist-bauhaus',
    // Business
    'executive-blue',
    'tech-minimal',
    // Kawaii
    'kawaii-sakura',
    // Modern
    'modern-minimalist',
    'modern-velvet-night',
    'modern-paper-memo',
    'modern-aqua-depth',
    // Social
    'social-youtube',
    // NOTE: 'custom' is ALWAYS PRO — not included here intentionally.
    // Add new free themes here as the catalog grows.
]);

// ---------------------------------------------------------------------------
// PRO Font Families
// Any fontFamily NOT in this set is PRO.
// ---------------------------------------------------------------------------
export const FREE_FONT_FAMILIES = new Set<string>([
    "'Inter', sans-serif",
    "'DM Sans', sans-serif",
    "'Poppins', sans-serif",
    "'Montserrat', sans-serif",
    "'Outfit', sans-serif",
    "'Space Grotesk', sans-serif",
    "'Bricolage Grotesque', sans-serif",
    "'Syne', sans-serif",
    "'Merriweather', serif",
    "'Playfair Display', serif",
    "'Fredoka', sans-serif",
    "'Space Mono', monospace",
    "'Roboto Condensed', sans-serif",
    "'Patrick Hand', cursive",
    "'Courier New', monospace",
]);

// ---------------------------------------------------------------------------
// PRO Layouts
// ---------------------------------------------------------------------------
export const PRO_LAYOUTS = new Set<string>(['compact', 'banner']);

// ---------------------------------------------------------------------------
// PRO Header Styles
// ---------------------------------------------------------------------------
export const PRO_HEADER_STYLES = new Set<string>(['logo']);

// ---------------------------------------------------------------------------
// Custom color fields — only available on PRO (required for custom theme)
// ---------------------------------------------------------------------------
export const PRO_CUSTOM_COLOR_FIELDS = [
    'customButtonColor',
    'customTextColor',
    'customCollectionTextColor',
    'customButtonTextColor',
] as const;

// ---------------------------------------------------------------------------
// Core guard function
// ---------------------------------------------------------------------------

export interface PlanGuardResult {
    allowed: boolean;
    /** Fields that were stripped from the update (free user tried to save PRO feature) */
    strippedFields: string[];
}

/**
 * Validates and sanitizes a profile update payload for a FREE user.
 * 
 * For PRO users, this is a no-op and returns { allowed: true, strippedFields: [] }.
 * For FREE users, any PRO feature is silently stripped from `updates`.
 * The frontend is responsible for enforcing the "preview mode" UX.
 * 
 * @param planType - The user's current plan from the DB (not from the request body)
 * @param updates  - The profile update payload (mutated in place)
 */
export function enforcePlanRestrictions(
    planType: string | null | undefined,
    updates: Record<string, any>
): PlanGuardResult {
    const isFree = !planType || planType === 'free';

    if (!isFree) {
        return { allowed: true, strippedFields: [] };
    }

    const stripped: string[] = [];

    // 1. Theme
    if (updates.themeId !== undefined) {
        const isCustom = updates.themeId === 'custom';
        const isFreeTheme = FREE_THEME_IDS.has(updates.themeId);
        if (isCustom || !isFreeTheme) {
            stripped.push(`themeId (${updates.themeId})`);
            delete updates.themeId;
        }
    }

    // 2. Font Family
    if (updates.fontFamily !== undefined) {
        if (!FREE_FONT_FAMILIES.has(updates.fontFamily)) {
            stripped.push(`fontFamily (${updates.fontFamily})`);
            delete updates.fontFamily;
        }
    }

    // 3. Header Layout
    if (updates.headerLayout !== undefined) {
        if (PRO_LAYOUTS.has(updates.headerLayout)) {
            stripped.push(`headerLayout (${updates.headerLayout})`);
            delete updates.headerLayout;
        }
    }

    // 4. Header Style
    if (updates.headerStyle !== undefined) {
        if (PRO_HEADER_STYLES.has(updates.headerStyle)) {
            stripped.push(`headerStyle (${updates.headerStyle})`);
            delete updates.headerStyle;
        }
    }

    // 5. Custom Color Overrides — PRO only
    for (const field of PRO_CUSTOM_COLOR_FIELDS) {
        if (updates[field] !== undefined && updates[field] !== null) {
            stripped.push(field);
            delete updates[field];
        }
    }

    // 6. Logo URL — only relevant if headerStyle is 'logo' (PRO)
    // We strip it proactively if the user is free to keep DB clean
    if (updates.logoUrl !== undefined && updates.logoUrl !== null) {
        stripped.push('logoUrl');
        delete updates.logoUrl;
    }

    // 7. Hide Branding — PRO only
    if (updates.hideBranding === true) {
        stripped.push('hideBranding');
        delete updates.hideBranding;
    }

    if (stripped.length > 0) {
        console.warn(`[PlanGuard] Free user attempted to save PRO features: ${stripped.join(', ')}`);
    }

    return {
        allowed: true, // We allow the request but strip the PRO fields
        strippedFields: stripped,
    };
}
