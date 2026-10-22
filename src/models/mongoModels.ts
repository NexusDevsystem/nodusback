import mongoose, { Schema, SchemaOptions } from 'mongoose';
import crypto from 'crypto';

const defaultOptions: SchemaOptions = {
    timestamps: false,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
};

// --- 1. USER SCHEMA ---
export interface IUser {
    _id: string;
    id: string;
    email: string;
    username: string;
    name: string;
    bio?: string;
    avatar_url?: string;
    theme_id?: string;
    font_family?: string;
    button_style?: string;
    button_style_type?: string;
    button_roundness?: string;
    button_shadow?: boolean;
    custom_background?: string;
    custom_text_color?: string;
    custom_solid_color?: string;
    custom_button_color?: string;
    custom_secondary_color?: string;
    custom_button_text_color?: string;
    custom_collection_text_color?: string;
    header_layout?: string;
    header_style?: string;
    logo_url?: string;
    avatar_size?: string;
    font_size?: number;
    bio_font_size?: number;
    font_weight?: string;
    font_italic?: boolean;
    enable_blur?: boolean;
    banner_blur_color?: string;
    hide_branding?: boolean;
    onboarding_completed?: boolean;
    show_store_shortcut_on_links?: boolean;
    has_profile_pic?: boolean;
    has_first_link?: boolean;
    has_copied_url?: boolean;
    onboarding_dismissed?: boolean;
    last_incomplete_notification_at?: Date | null;
    likes_count?: number;
    views_count?: number;
    visitors_count?: number;
    auth_provider?: string;
    plan_type?: string;
    subscription_status?: string;
    subscription_expiry_date?: Date | null;
    abacate_customer_id?: string | null;
    tax_id?: string | null;
    cellphone?: string | null;
    user_category?: string | null;
    referral_source?: string | null;
    is_verified?: boolean;
    seo_title?: string | null;
    seo_description?: string | null;
    payment_methods?: any[];
    integrations?: any[];
    password_hash?: string;
    tutorial_status?: any;
    show_newsletter?: boolean;
    support_type?: string | null;
    support_key?: string | null;
    username_updated_at?: Date | null;
    created_at?: Date;
    updated_at?: Date;
}

const UserSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    email: { type: String, required: true, lowercase: true, index: true },
    username: { type: String, lowercase: true, index: true },
    name: { type: String, default: '' },
    bio: { type: String, default: '' },
    avatar_url: { type: String, default: '' },
    theme_id: { type: String, default: 'brutalist-bauhaus' },
    font_family: { type: String, default: "'Inter', sans-serif" },
    button_style: { type: String, default: 'rounded' },
    button_style_type: { type: String, default: null },
    button_roundness: { type: String, default: null },
    button_shadow: { type: Boolean, default: null },
    custom_background: { type: String, default: null },
    custom_text_color: { type: String, default: null },
    custom_solid_color: { type: String, default: null },
    custom_button_color: { type: String, default: null },
    custom_secondary_color: { type: String, default: null },
    custom_button_text_color: { type: String, default: null },
    custom_collection_text_color: { type: String, default: null },
    header_layout: { type: String, default: 'classic' },
    header_style: { type: String, default: 'text' },
    logo_url: { type: String, default: null },
    avatar_size: { type: String, default: 'md' },
    font_size: { type: Number, default: 14 },
    bio_font_size: { type: Number, default: 13 },
    font_weight: { type: String, default: 'normal' },
    font_italic: { type: Boolean, default: false },
    enable_blur: { type: Boolean, default: false },
    banner_blur_color: { type: String, default: null },
    hide_branding: { type: Boolean, default: false },
    onboarding_completed: { type: Boolean, default: false },
    show_store_shortcut_on_links: { type: Boolean, default: true },
    has_profile_pic: { type: Boolean, default: false },
    has_first_link: { type: Boolean, default: false },
    has_copied_url: { type: Boolean, default: false },
    onboarding_dismissed: { type: Boolean, default: false },
    last_incomplete_notification_at: { type: Date, default: null },
    likes_count: { type: Number, default: 0 },
    views_count: { type: Number, default: 0 },
    visitors_count: { type: Number, default: 0 },
    auth_provider: { type: String, default: 'email' },
    plan_type: { type: String, default: 'free' },
    subscription_status: { type: String, default: null },
    subscription_expiry_date: { type: Date, default: null },
    abacate_customer_id: { type: String, default: null },
    tax_id: { type: String, default: null },
    cellphone: { type: String, default: null },
    user_category: { type: String, default: null },
    referral_source: { type: String, default: null },
    is_verified: { type: Boolean, default: false },
    seo_title: { type: String, default: null },
    seo_description: { type: String, default: null },
    payment_methods: { type: [Schema.Types.Mixed], default: [] },
    integrations: { type: [Schema.Types.Mixed], default: [] },
    password_hash: { type: String, default: null },
    tutorial_status: { type: Schema.Types.Mixed, default: {} },
    show_newsletter: { type: Boolean, default: false },
    support_type: { type: String, default: null },
    support_key: { type: String, default: null },
    username_updated_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

UserSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 2. LINK SCHEMA ---
export interface ILink {
    _id: string;
    id: string;
    user_id: string;
    parent_id?: string | null;
    title: string;
    url: string;
    icon?: string;
    icon_name?: string | null;
    is_active: boolean;
    clicks: number;
    layout?: string;
    type?: string;
    highlight?: string;
    embed_type?: string;
    subtitle?: string;
    is_archived: boolean;
    platform?: string;
    position: number;
    schedule_start?: Date | null;
    schedule_end?: Date | null;
    video_url?: string | null;
    is_password_protected?: boolean;
    password_hash?: string | null;
    provider_account_id?: string | null;
    show_countdown?: boolean;
    metadata?: any;
    youtube_display_mode?: string | null;
    created_at?: Date;
    updated_at?: Date;
}

const LinkSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    parent_id: { type: String, default: null, index: true },
    title: { type: String, default: '' },
    url: { type: String, default: '' },
    icon: { type: String, default: '' },
    icon_name: { type: String, default: null },
    is_active: { type: Boolean, default: true },
    clicks: { type: Number, default: 0 },
    layout: { type: String, default: 'classic' },
    type: { type: String, default: 'link' },
    highlight: { type: String, default: 'none' },
    embed_type: { type: String, default: 'none' },
    subtitle: { type: String, default: null },
    is_archived: { type: Boolean, default: false, index: true },
    platform: { type: String, default: null },
    position: { type: Number, default: 0 },
    schedule_start: { type: Date, default: null },
    schedule_end: { type: Date, default: null },
    video_url: { type: String, default: null },
    is_password_protected: { type: Boolean, default: false },
    password_hash: { type: String, default: null },
    provider_account_id: { type: String, default: null },
    show_countdown: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: null },
    youtube_display_mode: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

LinkSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 3. PRODUCT SCHEMA ---
export interface IProduct {
    _id: string;
    id: string;
    user_id: string;
    name: string;
    price?: string;
    image?: string;
    url?: string;
    discount_code?: string;
    position: number;
    clicks: number;
    store_id?: string;
    is_active: boolean;
    created_at?: Date;
    updated_at?: Date;
}

const ProductSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    price: { type: String, default: '' },
    image: { type: String, default: '' },
    url: { type: String, default: '' },
    discount_code: { type: String, default: null },
    position: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    store_id: { type: String, default: null, index: true },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

ProductSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 4. STORE SCHEMA ---
export interface IStore {
    _id: string;
    id: string;
    user_id: string;
    name: string;
    description?: string;
    image_url?: string;
    position: number;
    is_active: boolean;
    collections?: string[];
    disabled_collections?: string[];
    created_at?: Date;
    updated_at?: Date;
}

const StoreSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    image_url: { type: String, default: '' },
    position: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    collections: { type: [String], default: [] },
    disabled_collections: { type: [String], default: [] },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

StoreSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 5. EVENT SCHEMA ---
export interface IEvent {
    _id: string;
    id: string;
    user_id: string;
    collection_id: string;
    title: string;
    date: string;
    time?: string;
    location?: string;
    url?: string;
    status?: string;
    position: number;
    schedule_start?: Date | null;
    schedule_end?: Date | null;
    created_at?: Date;
    updated_at?: Date;
}

const EventSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    collection_id: { type: String, required: true, index: true },
    title: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, default: null },
    location: { type: String, default: '' },
    url: { type: String, default: '' },
    status: { type: String, default: 'Tickets' },
    position: { type: Number, default: 0 },
    schedule_start: { type: Date, default: null },
    schedule_end: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

EventSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 6. LEAD SCHEMA ---
export interface ILead {
    _id: string;
    id: string;
    user_id: string;
    name?: string;
    email: string;
    phone?: string;
    message?: string;
    created_at?: Date;
}

const LeadSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    email: { type: String, required: true },
    phone: { type: String, default: '' },
    message: { type: String, default: '' },
    created_at: { type: Date, default: Date.now }
}, defaultOptions);

LeadSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 7. CLICK SCHEMA ---
export interface IClick {
    _id: string;
    id: string;
    user_id: string;
    link_id?: string | null;
    product_id?: string | null;
    type: string;
    fingerprint?: string | null;
    created_at?: Date;
}

const ClickSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    link_id: { type: String, default: null, index: true },
    product_id: { type: String, default: null, index: true },
    type: { type: String, required: true, index: true },
    fingerprint: { type: String, default: null, index: true },
    created_at: { type: Date, default: Date.now, index: true }
}, defaultOptions);

ClickSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 8. SOCIAL INTEGRATION SCHEMA ---
export interface ISocialIntegration {
    _id: string;
    id: string;
    user_id: string;
    provider: string;
    provider_account_id?: string | null;
    profile_data?: any;
    access_token?: string | null;
    refresh_token?: string | null;
    token_expires_at?: Date | null;
    created_at?: Date;
    updated_at?: Date;
}

const SocialIntegrationSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    provider: { type: String, required: true, index: true },
    provider_account_id: { type: String, default: null },
    profile_data: { type: Schema.Types.Mixed, default: {} },
    access_token: { type: String, default: null },
    refresh_token: { type: String, default: null },
    token_expires_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

SocialIntegrationSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 9. BLOG POST SCHEMA ---
export interface IBlogPost {
    _id: string;
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    image_url?: string;
    category: string;
    author: string;
    color?: string;
    is_published: boolean;
    likes_count: number;
    views_count: number;
    published_at?: Date | null;
    position: number;
    created_at?: Date;
    updated_at?: Date;
}

const BlogPostSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    excerpt: { type: String, default: '' },
    content: { type: String, default: '' },
    image_url: { type: String, default: null },
    category: { type: String, default: 'General' },
    author: { type: String, default: 'Nodus' },
    color: { type: String, default: '#97cd7a' },
    is_published: { type: Boolean, default: false },
    likes_count: { type: Number, default: 0 },
    views_count: { type: Number, default: 0 },
    published_at: { type: Date, default: null },
    position: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

BlogPostSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 10. BLOG POST LIKE SCHEMA ---
export interface IBlogPostLike {
    _id: string;
    id: string;
    post_id: string;
    fingerprint: string;
    created_at?: Date;
}

const BlogPostLikeSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    post_id: { type: String, required: true, index: true },
    fingerprint: { type: String, required: true, index: true },
    created_at: { type: Date, default: Date.now }
}, defaultOptions);

// --- 11. AUTH OTP SCHEMA ---
export interface IAuthOtp {
    _id: string;
    id: string;
    email: string;
    otp_digest: string;
    expires_at: Date;
    attempts: number;
    created_at?: Date;
}

const AuthOtpSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    email: { type: String, required: true, index: true },
    otp_digest: { type: String, required: true },
    expires_at: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
}, defaultOptions);

// --- 12. ROADMAP TASK SCHEMA ---
export interface IRoadmapTask {
    _id: string;
    id: string;
    title: string;
    description?: string;
    status: string;
    author_name?: string;
    votes: number;
    is_admin: boolean;
    created_at?: Date;
    updated_at?: Date;
}

const RoadmapTaskSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    status: { type: String, default: 'planned' },
    author_name: { type: String, default: '' },
    votes: { type: Number, default: 0 },
    is_admin: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

RoadmapTaskSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 13. ANNOUNCEMENT SCHEMA ---
export interface IAnnouncement {
    _id: string;
    id: string;
    title: string;
    content: string;
    image_url?: string;
    image_urls?: string[];
    is_active: boolean;
    target_user_email?: string | null;
    blog_post_id?: string | null;
    created_at?: Date;
    updated_at?: Date;
}

const AnnouncementSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    image_url: { type: String, default: null },
    image_urls: { type: [String], default: [] },
    is_active: { type: Boolean, default: true },
    target_user_email: { type: String, default: null },
    blog_post_id: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

AnnouncementSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- 14. ANNOUNCEMENT VIEW SCHEMA ---
export interface IAnnouncementView {
    _id: string;
    user_id: string;
    announcement_id: string;
    seen_at: Date;
}

const AnnouncementViewSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    user_id: { type: String, required: true, index: true },
    announcement_id: { type: String, required: true, index: true },
    seen_at: { type: Date, default: Date.now }
}, defaultOptions);

// --- 15. VERIFICATION REQUEST SCHEMA ---
export interface IVerificationRequest {
    _id: string;
    id: string;
    user_id: string;
    status: string;
    reason?: string;
    nodus_link?: string;
    display_name?: string;
    contact_email?: string;
    category?: string;
    social_link_1?: string;
    social_link_2?: string;
    social_link_3?: string;
    has_verified_badge?: boolean;
    press_link_1?: string;
    press_link_2?: string;
    press_link_3?: string;
    created_at?: Date;
    updated_at?: Date;
}

const VerificationRequestSchema = new Schema({
    _id: { type: String, default: () => crypto.randomUUID() },
    id: { type: String, index: true },
    user_id: { type: String, required: true, index: true },
    status: { type: String, default: 'pending' },
    reason: { type: String, default: null },
    nodus_link: { type: String, default: null },
    display_name: { type: String, default: null },
    contact_email: { type: String, default: null },
    category: { type: String, default: null },
    social_link_1: { type: String, default: null },
    social_link_2: { type: String, default: null },
    social_link_3: { type: String, default: null },
    has_verified_badge: { type: Boolean, default: false },
    press_link_1: { type: String, default: null },
    press_link_2: { type: String, default: null },
    press_link_3: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, defaultOptions);

VerificationRequestSchema.pre('save', function () {
    if (!this.id) this.id = String(this._id);
});

// --- MODELS EXPORTS ---
export const UserModel = mongoose.models.User || mongoose.model('User', UserSchema, 'users');
export const LinkModel = mongoose.models.Link || mongoose.model('Link', LinkSchema, 'links');
export const ProductModel = mongoose.models.Product || mongoose.model('Product', ProductSchema, 'products');
export const StoreModel = mongoose.models.Store || mongoose.model('Store', StoreSchema, 'stores');
export const EventModel = mongoose.models.Event || mongoose.model('Event', EventSchema, 'events');
export const LeadModel = mongoose.models.Lead || mongoose.model('Lead', LeadSchema, 'leads');
export const ClickModel = mongoose.models.Click || mongoose.model('Click', ClickSchema, 'clicks');
export const SocialIntegrationModel = mongoose.models.SocialIntegration || mongoose.model('SocialIntegration', SocialIntegrationSchema, 'social_integrations');
export const BlogPostModel = mongoose.models.BlogPost || mongoose.model('BlogPost', BlogPostSchema, 'blog_posts');
export const BlogPostLikeModel = mongoose.models.BlogPostLike || mongoose.model('BlogPostLike', BlogPostLikeSchema, 'blog_post_likes');
export const AuthOtpModel = mongoose.models.AuthOtp || mongoose.model('AuthOtp', AuthOtpSchema, 'auth_otps');
export const RoadmapTaskModel = mongoose.models.RoadmapTask || mongoose.model('RoadmapTask', RoadmapTaskSchema, 'roadmap_tasks');
export const AnnouncementModel = mongoose.models.Announcement || mongoose.model('Announcement', AnnouncementSchema, 'announcements');
export const AnnouncementViewModel = mongoose.models.AnnouncementView || mongoose.model('AnnouncementView', AnnouncementViewSchema, 'announcement_views');
export const VerificationRequestModel = mongoose.models.VerificationRequest || mongoose.model('VerificationRequest', VerificationRequestSchema, 'verification_requests');
