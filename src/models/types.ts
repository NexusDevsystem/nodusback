// Database types (snake_case to match Supabase schema)
export interface UserProfileDB {
    id?: string;
    email: string;
    username: string;
    name: string;
    bio?: string;
    avatar_url?: string;
    auth_provider?: string;
    plan_type?: 'free' | 'monthly' | 'annual';
    subscription_status?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
    subscription_expiry_date?: string | null;
    stripe_customer_id?: string | null;
    tax_id?: string | null;
    cellphone?: string | null;
    theme_id: string;
    font_family: string;
    button_style?: 'rounded' | 'soft-rect';
    button_style_type?: 'solid' | 'outline' | 'glass' | 'soft' | 'hard-shadow' | 'push' | 'gradient' | 'cyber' | 'neon' | 'skeuo' | 'minimal-hover' | 'paper' | 'liquid' | null;
    button_roundness?: 'square' | 'round' | 'rounder' | 'full' | null;
    show_newsletter?: boolean;
    custom_background?: string | null;
    custom_text_color?: string | null;
    custom_solid_color?: string | null;
    custom_button_color?: string | null;
    is_verified?: boolean;
    enable_blur?: boolean;
    font_size?: number;
    font_weight?: string;
    font_italic?: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface LinkItemDB {
    id?: string;
    user_id: string;  // FK to users(id)
    parent_id?: string | null;
    title: string;
    url: string;
    icon?: string;
    is_active: boolean;
    clicks?: number;
    layout?: string;
    type?: string;
    highlight?: string;
    embed_type?: string;
    subtitle?: string;
    is_archived: boolean;
    platform?: string;
    position?: number;
    created_at?: string;
    updated_at?: string;
}

export interface ProductDB {
    id?: string;
    user_id: string;  // FK to users(id)
    name: string;
    price?: string;
    image: string;
    url: string;
    discount_code?: string;
    clicks?: number;
    position?: number;
    created_at?: string;
    updated_at?: string;
}

export interface AnalyticsEvent {
    id?: string;
    user_id: string;  // FK to users(id)
    link_id?: string;
    product_id?: string;
    event_type: string;
    timestamp: string;
}

export interface NewsletterLead {
    id: string;
    user_id: string;  // FK to users(id)
    email: string;
    name?: string;
    timestamp: string;
}

// API types (camelCase for frontend compatibility)
export interface UserProfile {
    id?: string;
    email: string;
    username?: string;
    name: string;
    bio: string;
    avatarUrl: string;
    authProvider?: string;
    planType?: 'free' | 'monthly' | 'annual';
    subscriptionStatus?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
    subscriptionExpiryDate?: string | null;
    stripeCustomerId?: string | null;
    taxId?: string | null;
    cellphone?: string | null;
    themeId: string;
    fontFamily: string;
    buttonStyle?: 'rounded' | 'soft-rect';
    buttonStyleType?: 'solid' | 'outline' | 'glass' | 'soft' | 'hard-shadow' | 'push' | 'gradient' | 'cyber' | 'neon' | 'skeuo' | 'minimal-hover' | 'paper' | 'liquid' | null;
    buttonRoundness?: 'square' | 'round' | 'rounder' | 'full' | null;
    showNewsletter?: boolean;
    customBackground?: string | null;
    customTextColor?: string | null;
    customSolidColor?: string | null;
    customButtonColor?: string | null;
    isVerified?: boolean;
    enableBlur?: boolean;
    fontSize?: number;
    fontWeight?: string;
    fontItalic?: boolean;
}

export interface LinkItem {
    id: string;
    title: string;
    url: string;
    image?: string;
    isActive: boolean;
    layout?: 'classic' | 'social' | 'card' | 'icon' | 'grid' | 'carousel' | 'stacked';
    type?: 'link' | 'collection' | 'social';
    children?: LinkItem[];
    highlight?: 'none' | 'pulse' | 'bounce' | 'shake' | 'glow' | 'wobble';
    embedType?: 'none' | 'youtube' | 'spotify' | 'deezer';
    subtitle?: string;
    isArchived?: boolean;
    platform?: string;
}

export interface Product {
    id: string;
    name: string;
    price?: string;
    image: string;
    url: string;
    discountCode?: string;
    collection?: string;
}

// Mapping Functions
export function dbToApi(dbProfile: UserProfileDB): UserProfile {
    return {
        id: dbProfile.id,
        email: dbProfile.email,
        username: dbProfile.username,
        name: dbProfile.name,
        bio: dbProfile.bio || '',
        avatarUrl: dbProfile.avatar_url || '',
        authProvider: dbProfile.auth_provider,
        planType: dbProfile.plan_type,
        subscriptionStatus: dbProfile.subscription_status,
        subscriptionExpiryDate: dbProfile.subscription_expiry_date,
        stripeCustomerId: dbProfile.stripe_customer_id,
        taxId: dbProfile.tax_id,
        cellphone: dbProfile.cellphone,
        themeId: dbProfile.theme_id,
        fontFamily: dbProfile.font_family,
        buttonStyle: dbProfile.button_style,
        buttonStyleType: dbProfile.button_style_type,
        buttonRoundness: dbProfile.button_roundness,
        showNewsletter: dbProfile.show_newsletter,
        customBackground: dbProfile.custom_background,
        customTextColor: dbProfile.custom_text_color,
        customSolidColor: dbProfile.custom_solid_color,
        customButtonColor: dbProfile.custom_button_color,
        isVerified: !!(dbProfile.is_verified || (dbProfile.username && dbProfile.username.trim().toLowerCase() === 'noduscc') || (dbProfile.name && dbProfile.name.trim().toLowerCase() === 'nodus.cc')),
        enableBlur: dbProfile.enable_blur,
        fontSize: dbProfile.font_size,
        fontWeight: dbProfile.font_weight,
        fontItalic: dbProfile.font_italic
    };
}

export function apiToDb(apiProfile: Partial<UserProfile>): Partial<UserProfileDB> {
    const dbProfile: Partial<UserProfileDB> = {};

    if (apiProfile.email !== undefined) dbProfile.email = apiProfile.email;
    if (apiProfile.name !== undefined) dbProfile.name = apiProfile.name;
    if (apiProfile.bio !== undefined) dbProfile.bio = apiProfile.bio;
    if (apiProfile.avatarUrl !== undefined) dbProfile.avatar_url = apiProfile.avatarUrl;
    if (apiProfile.authProvider !== undefined) dbProfile.auth_provider = apiProfile.authProvider;
    if (apiProfile.planType !== undefined) dbProfile.plan_type = apiProfile.planType;
    if (apiProfile.subscriptionStatus !== undefined) dbProfile.subscription_status = apiProfile.subscriptionStatus;
    if (apiProfile.subscriptionExpiryDate !== undefined) dbProfile.subscription_expiry_date = apiProfile.subscriptionExpiryDate;
    if (apiProfile.stripeCustomerId !== undefined) dbProfile.stripe_customer_id = apiProfile.stripeCustomerId;
    if (apiProfile.taxId !== undefined) dbProfile.tax_id = apiProfile.taxId;
    if (apiProfile.cellphone !== undefined) dbProfile.cellphone = apiProfile.cellphone;
    if (apiProfile.themeId !== undefined) dbProfile.theme_id = apiProfile.themeId;
    if (apiProfile.fontFamily !== undefined) dbProfile.font_family = apiProfile.fontFamily;
    if (apiProfile.buttonStyle !== undefined) dbProfile.button_style = apiProfile.buttonStyle;
    if (apiProfile.buttonStyleType !== undefined) dbProfile.button_style_type = apiProfile.buttonStyleType;
    if (apiProfile.buttonRoundness !== undefined) dbProfile.button_roundness = apiProfile.buttonRoundness;
    if (apiProfile.showNewsletter !== undefined) dbProfile.show_newsletter = apiProfile.showNewsletter;
    if (apiProfile.customBackground !== undefined) dbProfile.custom_background = apiProfile.customBackground;
    if (apiProfile.customTextColor !== undefined) dbProfile.custom_text_color = apiProfile.customTextColor;
    if (apiProfile.customSolidColor !== undefined) dbProfile.custom_solid_color = apiProfile.customSolidColor;
    if (apiProfile.customButtonColor !== undefined) dbProfile.custom_button_color = apiProfile.customButtonColor;
    if (apiProfile.username !== undefined) dbProfile.username = apiProfile.username;
    if (apiProfile.isVerified !== undefined) dbProfile.is_verified = apiProfile.isVerified;
    if (apiProfile.enableBlur !== undefined) dbProfile.enable_blur = apiProfile.enableBlur;
    if (apiProfile.fontSize !== undefined) dbProfile.font_size = apiProfile.fontSize;
    if (apiProfile.fontWeight !== undefined) dbProfile.font_weight = apiProfile.fontWeight;
    if (apiProfile.fontItalic !== undefined) dbProfile.font_italic = apiProfile.fontItalic;

    return dbProfile;
}

export function linkDbToApi(db: LinkItemDB): LinkItem {
    return {
        id: db.id || '',
        title: db.title,
        url: db.url,
        image: db.icon, // Map icon to image
        isActive: db.is_active,
        layout: db.layout as any,
        type: db.type as any,
        highlight: db.highlight as any,
        embedType: db.embed_type as any,
        subtitle: db.subtitle,
        isArchived: db.is_archived,
        platform: db.platform
    };
}

export function linkApiToDb(api: Partial<LinkItem>, userId: string): Partial<LinkItemDB> {
    const dbLink: Partial<LinkItemDB> = {
        user_id: userId,  // FK to users(id)
        parent_id: (api as any).parentId || null, // Map parentId if exists
        title: api.title,
        url: api.url,
        icon: api.image, // Map image to icon
        is_active: api.isActive ?? true, // Default to true if not specified
        layout: api.layout,
        type: api.type,
        highlight: api.highlight,
        embed_type: api.embedType,
        subtitle: api.subtitle,
        is_archived: api.isArchived ?? false,
        platform: api.platform
    };

    // IMPORTANT: Do NOT include the id field here
    // The database will generate its own UUID for new records
    // Only include id if we're updating an existing record (handled separately in updateLink)

    return dbLink;
}

export function productDbToApi(db: ProductDB): Product {
    const nameParts = db.name.split('||');
    const hasCollection = nameParts.length > 1;

    return {
        id: db.id || '',
        name: hasCollection ? nameParts[1].trim() : db.name,
        collection: hasCollection ? nameParts[0].trim() : undefined,
        price: db.price,
        image: db.image,
        url: db.url,
        discountCode: db.discount_code
    };
}

export function productApiToDb(api: Partial<Product>, userId: string): Partial<ProductDB> {
    const dbName = api.collection
        ? `${api.collection} || ${api.name}`
        : api.name;

    return {
        user_id: userId,  // FK to users(id)
        name: dbName,
        price: api.price,
        image: api.image,
        url: api.url,
        discount_code: api.discountCode
    };
}

export interface SocialIntegrationDB {
    id?: string;
    user_id: string; // FK to users(id)
    provider: 'youtube' | 'instagram' | 'tiktok' | 'twitch';
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    profile_data?: {
        username?: string;
        follower_count?: number;
        avatar_url?: string;
        channel_id?: string;
    };
    created_at?: string;
    updated_at?: string;
}
