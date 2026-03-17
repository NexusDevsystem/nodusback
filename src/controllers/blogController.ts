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
            .order('published_at', { ascending: false });

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
            .order('created_at', { ascending: false });

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
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w ]+/g, '')
                .replace(/ +/g, '-');
        }

        const { data, error } = await supabase
            .from('blog_posts')
            .insert({
                ...postData,
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
