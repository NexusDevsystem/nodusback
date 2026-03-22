import { supabase } from '../config/supabaseClient.js';
import { blogPostDbToApi, BlogPostDB } from '../models/types.js';

export const blogService = {
    async getPostBySlug(slug: string) {
        const { data, error } = await supabase
            .from('blog_posts')
            .select('*')
            .eq('slug', slug)
            .maybeSingle();

        if (error) throw error;
        if (!data) return null;

        return blogPostDbToApi(data as BlogPostDB);
    }
};
