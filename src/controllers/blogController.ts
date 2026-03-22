import { Response } from 'express';
import { supabase } from '../config/supabaseClient.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { blogPostDbToApi, blogPostApiToDb, BlogPostDB } from '../models/types.js';

/**
 * Public: Get all published blog posts
 */
export const getAllPosts = async (req: AuthRequest, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('blog_posts')
            .select('*')
            .eq('is_published', true)
            .order('position', { ascending: true });

        if (error) throw error;

        const posts = (data as BlogPostDB[]).map(blogPostDbToApi);
        return res.json(posts);
    } catch (error: any) {
        console.error('Error fetching blog posts:', error);
        return res.status(500).json({ error: 'Failed to fetch blog posts' });
    }
};

/**
 * Superadmin: Get all blog posts (including drafts)
 */
export const getAdminPosts = async (req: AuthRequest, res: Response) => {
    try {
        if (req.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { data, error } = await supabase
            .from('blog_posts')
            .select('*')
            .order('position', { ascending: true });

        if (error) throw error;

        const posts = (data as BlogPostDB[]).map(blogPostDbToApi);
        return res.json(posts);
    } catch (error: any) {
        console.error('Error fetching admin blog posts:', error);
        return res.status(500).json({ error: 'Failed to fetch admin blog posts' });
    }
};

/**
 * Public: Get single post by slug
 */
export const getPostBySlug = async (req: AuthRequest, res: Response) => {
    try {
        const { slug } = req.params;
        const { data, error } = await supabase
            .from('blog_posts')
            .select('*')
            .eq('slug', slug)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Post not found' });

        return res.json(blogPostDbToApi(data as BlogPostDB));
    } catch (error: any) {
        console.error('Error fetching blog post by slug:', error);
        return res.status(500).json({ error: 'Failed to fetch blog post' });
    }
};

/**
 * Superadmin: Create new blog post
 */
export const createPost = async (req: AuthRequest, res: Response) => {
    try {
        if (req.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const postData = blogPostApiToDb(req.body);
        
        // Ensure slug is unique/generated if not provided
        if (!postData.slug) {
            const baseTitle = postData.title || 'untitled-post';
            postData.slug = baseTitle
                .toLowerCase()
                .trim()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // Remove accents
                .replace(/[^\w ]+/g, '')        // Remove non-alphanumeric
                .split(/\s+/)                  // Split by spaces
                .slice(0, 6)                   // Take first 6 words
                .join('-')                     // Join with hyphens
                .substring(0, 50);             // Max 50 chars
        }

        const { data, error } = await supabase
            .from('blog_posts')
            .insert({
                ...postData,
                position: postData.position ?? 0,
                published_at: postData.is_published ? new Date().toISOString() : null
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json(blogPostDbToApi(data as BlogPostDB));
    } catch (error: any) {
        console.error('Error creating blog post:', error);
        return res.status(500).json({ error: 'Failed to create blog post' });
    }
};

/**
 * Superadmin: Reorder blog posts
 */
export const reorderPosts = async (req: AuthRequest, res: Response) => {
    try {
        if (req.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { posts } = req.body;
        if (!Array.isArray(posts)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }

        // Use a transaction or multiple updates
        // Supabase doesn't support bulk update with different values easily in one call without extra extensions
        // but we can loop through them or use a rpc
        const updates = posts.map((post: any, index: number) => 
            supabase
                .from('blog_posts')
                .update({ position: index })
                .eq('id', post.id)
        );

        await Promise.all(updates);

        return res.json({ success: true });
    } catch (error: any) {
        console.error('Error reordering blog posts:', error);
        return res.status(500).json({ error: 'Failed to reorder blog posts' });
    }
};

/**
 * Superadmin: Update blog post
 */
export const updatePost = async (req: AuthRequest, res: Response) => {
    try {
        if (req.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { id } = req.params;
        const postData = blogPostApiToDb(req.body);

        // If becoming published for the first time, set the date
        if (postData.is_published) {
            const { data: current } = await supabase.from('blog_posts').select('published_at').eq('id', id).single();
            if (current && !current.published_at) {
                postData.published_at = new Date().toISOString();
            }
        }

        const { data, error } = await supabase
            .from('blog_posts')
            .update(postData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return res.json(blogPostDbToApi(data as BlogPostDB));
    } catch (error: any) {
        console.error('Error updating blog post:', error);
        return res.status(500).json({ error: 'Failed to update blog post' });
    }
};

/**
 * Superadmin: Delete blog post
 */
export const deletePost = async (req: AuthRequest, res: Response) => {
    try {
        if (req.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { id } = req.params;
        const { error } = await supabase
            .from('blog_posts')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return res.status(204).send();
    } catch (error: any) {
        console.error('Error deleting blog post:', error);
        return res.status(500).json({ error: 'Failed to delete blog post' });
    }
};

/**
 * Public: Upvote a blog post (Unique per fingerprint)
 */
export const upvotePost = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { fingerprint } = req.body;

        if (!fingerprint) {
            return res.status(400).json({ error: 'Fingerprint required for like' });
        }
        
        // Insert into likes table to track unique like (Trigger will handle the count update)
        // If it already exists, just return current data
        const { error: insertError } = await supabase
            .from('blog_post_likes')
            .insert({ 
                post_id: id, 
                fingerprint: fingerprint 
            });
            
        // 23505 is the error code for unique constraint violation (already liked)
        if (insertError && insertError.code !== '23505') {
            console.error('Error recording like:', insertError);
            throw insertError;
        }
        
        // Fetch updated post data
        const { data: updated, error: fetchError } = await supabase
            .from('blog_posts')
            .select('*')
            .eq('id', id)
            .single();
            
        if (fetchError || !updated) {
            return res.status(404).json({ error: 'Post not found' });
        }

        return res.json(blogPostDbToApi(updated as BlogPostDB));
    } catch (error: any) {
        console.error('Error upvoting blog post:', error);
        return res.status(500).json({ error: 'Failed to upvote blog post' });
    }
};

/**
 * Public: Increment blog post views
 */
export const incrementViews = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        
        // Use a simple update to increment
        const { data: current } = await supabase
            .from('blog_posts')
            .select('views_count')
            .eq('id', id)
            .single();

        if (current) {
            await supabase
                .from('blog_posts')
                .update({ views_count: (current.views_count || 0) + 1 })
                .eq('id', id);
        }

        return res.json({ success: true });
    } catch (error: any) {
        console.error('Error incrementing views:', error);
        return res.status(500).json({ error: 'Failed to increment views' });
    }
};
