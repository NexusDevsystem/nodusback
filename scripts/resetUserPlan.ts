import { profileService } from '../src/services/profileService.js';
import 'dotenv/config';

async function resetPlanByEmail(email: string) {
    console.log(`Buscando usuário com email: ${email}...`);
    const profile = await profileService.getProfileByEmail(email);

    if (!profile || !profile.id) {
        console.error('Perfil não encontrado para este email.');
        return;
    }

    console.log(`Usuário encontrado: ${profile.name} (ID: ${profile.id})`);
    console.log(`Resetando plano para 'free'...`);

    const updated = await profileService.updateProfile(profile.id, {
        planType: 'free',
        subscriptionStatus: 'canceled',
        subscriptionExpiryDate: null
    });

    if (updated) {
        console.log('SUCESSO: Plano resetado para Free.');
    } else {
        console.error('ERRO: Falha ao atualizar perfil.');
    }
}

const email = process.argv[2];
if (!email) {
    console.error('Por favor, forneça o email como argumento: npm run reset-plan -- email@exemplo.com');
} else {
    resetPlanByEmail(email).then(() => process.exit(0));
}
