import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: "c:\\Users\\jaoom\\OneDrive\\Área de Trabalho\\projetos\\nodus\\backend\\.env" });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY! || process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function initBucket() {
    const bucketName = "uploads";
    console.log(`Verificando bucket '${bucketName}'...`);
    const { data: buckets, error: getError } = await supabase.storage.listBuckets();

    if (getError) {
        console.error("Erro ao listar buckets:", getError);
        return;
    }

    const bucketExists = buckets?.find(b => b.name === bucketName);

    if (!bucketExists) {
        console.log(`Criando bucket: ${bucketName}...`);
        const { data, error } = await supabase.storage.createBucket(bucketName, {
            public: true,
        });
        if (error) {
            console.error("Erro ao criar bucket:", error);
        } else {
            console.log("Bucket criado com sucesso:", data);
        }
    } else {
        console.log("Bucket já existe!");
    }
}

initBucket();
