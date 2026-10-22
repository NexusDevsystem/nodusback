import { connectMongo, mongoose } from './mongoClient.js';
import {
    UserModel,
    LinkModel,
    ProductModel,
    StoreModel,
    EventModel,
    LeadModel,
    ClickModel,
    SocialIntegrationModel,
    BlogPostModel,
    BlogPostLikeModel,
    AuthOtpModel,
    RoadmapTaskModel,
    AnnouncementModel,
    AnnouncementViewModel,
    VerificationRequestModel
} from '../models/mongoModels.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Table to Model mapping
const modelMap: Record<string, any> = {
    users: UserModel,
    links: LinkModel,
    products: ProductModel,
    stores: StoreModel,
    events: EventModel,
    leads: LeadModel,
    clicks: ClickModel,
    social_integrations: SocialIntegrationModel,
    blog_posts: BlogPostModel,
    blog_post_likes: BlogPostLikeModel,
    auth_otps: AuthOtpModel,
    roadmap_tasks: RoadmapTaskModel,
    announcements: AnnouncementModel,
    announcement_views: AnnouncementViewModel,
    verification_requests: VerificationRequestModel,
};

function getModel(table: string): any {
    if (modelMap[table]) return modelMap[table];
    if (mongoose.models[table]) return mongoose.models[table];
    const schema = new mongoose.Schema({}, { strict: false, timestamps: false, versionKey: false });
    return mongoose.model(table, schema, table);
}

export class MongoQueryBuilder implements PromiseLike<any> {
    private model: any;
    private filter: any = {};
    private sortObj: any = {};
    private limitNum: number | null = null;
    private skipNum: number | null = null;
    private fields: string | null = null;
    private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    private payload: any = null;
    private isHead: boolean = false;
    private isExactCount: boolean = false;
    private isSingle: boolean = false;
    private isMaybeSingle: boolean = false;

    constructor(model: any) {
        this.model = model;
    }

    select(fields?: string, options?: { count?: string; head?: boolean }) {
        this.action = 'select';
        if (fields && fields !== '*') {
            this.fields = fields;
        }
        if (options?.head) {
            this.isHead = true;
        }
        if (options?.count) {
            this.isExactCount = true;
        }
        return this;
    }

    insert(data: any) {
        this.action = 'insert';
        this.payload = data;
        return this;
    }

    update(data: any) {
        this.action = 'update';
        this.payload = data;
        return this;
    }

    delete() {
        this.action = 'delete';
        return this;
    }

    upsert(data: any, options?: any) {
        this.action = 'upsert';
        this.payload = data;
        return this;
    }

    eq(col: string, val: any) {
        if (col === 'id') {
            this.filter.$or = [{ id: val }, { _id: val }];
        } else {
            this.filter[col] = val;
        }
        return this;
    }

    neq(col: string, val: any) {
        if (col === 'id') {
            this.filter.$and = [{ id: { $ne: val } }, { _id: { $ne: val } }];
        } else {
            this.filter[col] = { $ne: val };
        }
        return this;
    }

    in(col: string, vals: any[]) {
        if (col === 'id') {
            this.filter.$or = [{ id: { $in: vals } }, { _id: { $in: vals } }];
        } else {
            this.filter[col] = { $in: vals };
        }
        return this;
    }

    gt(col: string, val: any) {
        this.filter[col] = { ...this.filter[col], $gt: val };
        return this;
    }

    gte(col: string, val: any) {
        this.filter[col] = { ...this.filter[col], $gte: val };
        return this;
    }

    lt(col: string, val: any) {
        this.filter[col] = { ...this.filter[col], $lt: val };
        return this;
    }

    lte(col: string, val: any) {
        this.filter[col] = { ...this.filter[col], $lte: val };
        return this;
    }

    ilike(col: string, val: string) {
        const regexStr = '^' + val.replace(/%/g, '.*') + '$';
        this.filter[col] = new RegExp(regexStr, 'i');
        return this;
    }

    like(col: string, val: string) {
        const regexStr = '^' + val.replace(/%/g, '.*') + '$';
        this.filter[col] = new RegExp(regexStr);
        return this;
    }

    is(col: string, val: any) {
        this.filter[col] = val;
        return this;
    }

    not(col: string, operator: string, val: any) {
        if (operator === 'is') {
            this.filter[col] = { $ne: val };
        } else if (operator === 'in') {
            this.filter[col] = { $nin: val };
        } else {
            this.filter[col] = { $not: { [`$${operator}`]: val } };
        }
        return this;
    }

    or(expression: string) {
        // e.g. "email.eq.foo,username.eq.bar"
        const parts = expression.split(',').map(p => p.trim());
        const orConditions: any[] = [];
        for (const part of parts) {
            const [field, op, val] = part.split('.');
            if (field && op && val !== undefined) {
                if (op === 'eq') {
                    if (field === 'id') {
                        orConditions.push({ id: val });
                        orConditions.push({ _id: val });
                    } else {
                        orConditions.push({ [field]: val });
                    }
                } else if (op === 'ilike') {
                    orConditions.push({ [field]: new RegExp('^' + val.replace(/%/g, '.*') + '$', 'i') });
                }
            }
        }
        if (orConditions.length > 0) {
            this.filter.$or = [...(this.filter.$or || []), ...orConditions];
        }
        return this;
    }

    order(col: string, options?: { ascending?: boolean }) {
        this.sortObj[col] = options?.ascending ? 1 : -1;
        return this;
    }

    limit(n: number) {
        this.limitNum = n;
        return this;
    }

    range(from: number, to: number) {
        this.skipNum = from;
        this.limitNum = to - from + 1;
        return this;
    }

    single() {
        this.isSingle = true;
        return this;
    }

    maybeSingle() {
        this.isMaybeSingle = true;
        return this;
    }

    async then<TResult1 = any, TResult2 = never>(
        onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        try {
            await connectMongo();
            let result: any = { data: null, error: null, count: null };

            if (this.isHead) {
                const count = await this.model.countDocuments(this.filter);
                result = { data: null, error: null, count };
                return onfulfilled ? onfulfilled(result) : result;
            }

            if (this.action === 'select') {
                if (this.isExactCount) {
                    result.count = await this.model.countDocuments(this.filter);
                }

                let query = this.model.find(this.filter);
                if (this.sortObj && Object.keys(this.sortObj).length > 0) {
                    query = query.sort(this.sortObj);
                }
                if (this.skipNum !== null) {
                    query = query.skip(this.skipNum);
                }
                if (this.limitNum !== null) {
                    query = query.limit(this.limitNum);
                }

                if (this.fields) {
                    const projection: any = {};
                    this.fields.split(',').map((f: string) => f.trim()).forEach((f: string) => {
                        if (f) projection[f] = 1;
                    });
                    if (!projection.id) projection.id = 1;
                    if (!projection._id) projection._id = 1;
                    query = query.select(projection);
                }

                const docs = await query.lean().exec();

                const formatted = docs.map((doc: any) => {
                    const item = { ...doc };
                    if (!item.id && item._id) item.id = item._id;
                    return item;
                });

                if (this.isSingle) {
                    if (formatted.length === 0) {
                        result.data = null;
                        result.error = { message: 'Row not found', code: 'PGRST116' };
                    } else {
                        result.data = formatted[0];
                    }
                } else if (this.isMaybeSingle) {
                    result.data = formatted.length > 0 ? formatted[0] : null;
                } else {
                    result.data = formatted;
                }
            } else if (this.action === 'insert') {
                const items = Array.isArray(this.payload) ? this.payload : [this.payload];
                const prepared = items.map((item: any) => {
                    const doc = { ...item };
                    if (!doc._id && !doc.id) {
                        const newId = crypto.randomUUID();
                        doc._id = newId;
                        doc.id = newId;
                    } else if (doc.id && !doc._id) {
                        doc._id = String(doc.id);
                    } else if (doc._id && !doc.id) {
                        doc.id = String(doc._id);
                    }
                    return doc;
                });

                const created = await this.model.create(prepared);
                const formatted = created.map((c: any) => {
                    const obj = c.toObject();
                    if (!obj.id && obj._id) obj.id = obj._id;
                    return obj;
                });
                result.data = Array.isArray(this.payload) ? formatted : formatted[0];
            } else if (this.action === 'update') {
                const updatePayload = { ...this.payload, updated_at: new Date() };
                await this.model.updateMany(this.filter, { $set: updatePayload });
                const updated = await this.model.find(this.filter).lean().exec();
                result.data = updated.map((d: any) => ({ ...d, id: d.id || d._id }));
            } else if (this.action === 'delete') {
                await this.model.deleteMany(this.filter);
                result.data = [];
            } else if (this.action === 'upsert') {
                const items = Array.isArray(this.payload) ? this.payload : [this.payload];
                const upserted: any[] = [];
                for (const item of items) {
                    const id = item.id || item._id || crypto.randomUUID();
                    const doc = { ...item, id: String(id), _id: String(id), updated_at: new Date() };
                    const saved = await this.model.findOneAndUpdate(
                        { $or: [{ id }, { _id: id }] },
                        { $set: doc },
                        { upsert: true, new: true, setDefaultsOnInsert: true }
                    ).lean().exec();
                    upserted.push(saved);
                }
                result.data = Array.isArray(this.payload) ? upserted : upserted[0];
            }

            return onfulfilled ? onfulfilled(result) : result;
        } catch (error: any) {
            const errRes: any = { data: null, error: { message: error.message || String(error) } };
            return onfulfilled ? onfulfilled(errRes) : errRes;
        }
    }
}

const storage = {
    from: (bucket: string) => ({
        upload: async (filePath: string, buffer: Buffer, options?: any) => {
            try {
                const baseDir = path.resolve(process.cwd(), 'uploads', bucket);
                const fullPath = path.resolve(baseDir, filePath);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(fullPath, buffer);
                return { data: { path: filePath }, error: null };
            } catch (err: any) {
                return { data: null, error: err };
            }
        },
        remove: async (paths: string[]) => {
            try {
                for (const p of paths) {
                    const fullPath = path.resolve(process.cwd(), 'uploads', bucket, p);
                    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                }
                return { data: true, error: null };
            } catch (e: any) {
                return { data: null, error: e };
            }
        },
        getPublicUrl: (filePath: string) => {
            const baseUrl = process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL || '';
            const publicUrl = `${baseUrl}/uploads/${bucket}/${filePath}`;
            return { data: { publicUrl } };
        }
    })
};

export async function testConnection() {
    try {
        await connectMongo();
        console.log('✅ Conexão com MongoDB Atlas estabelecida com sucesso!');
        return true;
    } catch (error) {
        console.error('❌ Erro ao conectar com MongoDB:', error);
        return false;
    }
}

export const supabase = {
    from: (table: string) => new MongoQueryBuilder(getModel(table)),
    storage,
    rpc: async (fnName: string, args: any) => {
        try {
            await connectMongo();
            if (fnName === 'increment_views') {
                await UserModel.updateOne({ $or: [{ id: args.user_id }, { _id: args.user_id }] }, { $inc: { views_count: 1 } });
            } else if (fnName === 'increment_likes') {
                await UserModel.updateOne({ $or: [{ id: args.user_id }, { _id: args.user_id }] }, { $inc: { likes_count: 1 } });
            } else if (fnName === 'increment_clicks') {
                await LinkModel.updateOne({ $or: [{ id: args.link_id }, { _id: args.link_id }] }, { $inc: { clicks: 1 } });
            }
            return { data: true, error: null };
        } catch (e: any) {
            return { data: null, error: e };
        }
    },
    auth: {
        admin: {}
    }
};
