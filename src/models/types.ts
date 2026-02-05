export interface UserProfile {
    name: string;
    bio: string;
    avatarUrl: string;
    themeId: string;
    fontFamily: string;
    customBackground?: string;
    buttonStyle?: 'rounded' | 'soft-rect';
    showNewsletter?: boolean;
    newsletterTitle?: string;
    newsletterDescription?: string;
    supportType?: 'pix' | 'paypal';
    supportKey?: string;
    seoTitle?: string;
    seoDescription?: string;
    seoKeywords?: string;
    customCSS?: string;
    customTextColor?: string;
    customSolidColor?: string;
    customButtonColor?: string;
}

export interface LinkItem {
    id: string;
    title: string;
    url: string;
    image?: string;
    isActive: boolean;
    clicks?: number;
    layout?: 'button' | 'social';
    type?: 'link' | 'collection';
    children?: LinkItem[];
    highlight?: 'pulse' | 'bounce' | 'shake' | 'glow' | 'wobble';
    embedType?: 'youtube' | 'spotify';
}

export interface Product {
    id: string;
    name: string;
    price?: string;
    image: string;
    url: string;
    discountCode?: string;
}

export interface AnalyticsEvent {
    linkId: string;
    timestamp: string;
    type: 'click';
}

export interface NewsletterLead {
    id: string;
    email: string;
    name?: string;
    timestamp: string;
}
