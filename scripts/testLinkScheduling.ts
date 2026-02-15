
import { linkService } from '../src/services/linkService';
import { supabase } from '../src/config/supabaseClient';
import fs from 'fs';
import path from 'path';

async function testLinkScheduling() {
    const logBuffer: string[] = [];
    const log = (msg: string) => {
        console.log(msg);
        logBuffer.push(msg);
    };

    log('--- Testing Link Scheduling Logic ---');

    try {
        // 1. Setup
        const { data: users } = await supabase.from('users').select('id').limit(1);

        if (!users || users.length === 0) {
            log('No users found to test with.');
            fs.writeFileSync('verification_result.txt', logBuffer.join('\n'));
            return;
        }

        const userId = users[0].id;
        log(`Using User ID: ${userId}`);

        const now = new Date();
        const future = new Date(now.getTime() + 86400000).toISOString(); // +1 day
        const past = new Date(now.getTime() - 86400000).toISOString();   // -1 day

        // 2. Create Links
        log('Creating test links...');

        const linkA = await linkService.createLink(userId, {
            title: 'Link A (Always Active)',
            url: 'http://test.com/a',
            isActive: true
        });

        const linkB = await linkService.createLink(userId, {
            title: 'Link B (Future)',
            url: 'http://test.com/b',
            isActive: true,
            scheduleStart: future
        });

        const linkC = await linkService.createLink(userId, {
            title: 'Link C (Expired)',
            url: 'http://test.com/c',
            isActive: true,
            scheduleEnd: past
        });

        const linkD = await linkService.createLink(userId, {
            title: 'Link D (Active Window)',
            url: 'http://test.com/d',
            isActive: true,
            scheduleStart: past,
            scheduleEnd: future
        });

        if (!linkA || !linkB || !linkC || !linkD) {
            log('Failed to create one or more links');
            throw new Error('Link creation failed');
        }

        // 3. Test Private View
        log('\n--- Testing Private View (Owner) ---');
        const privateLinks = await linkService.getLinksByProfileId(userId, false);
        const privateIds = privateLinks.map(l => l.id);

        if (privateIds.includes(linkA.id) && privateIds.includes(linkB.id) && privateIds.includes(linkC.id) && privateIds.includes(linkD.id)) {
            log('✅ PASS: Owner sees all links.');
        } else {
            log(`❌ FAIL: Owner missing links. Expected 4, got ${privateLinks.length}`);
            log(`Ids found: ${JSON.stringify(privateIds)}`);
        }

        // 4. Test Public View
        log('\n--- Testing Public View ---');
        const publicLinks = await linkService.getLinksByProfileId(userId, true);
        const publicIds = publicLinks.map(l => l.id);

        const hasA = publicIds.includes(linkA.id);
        const hasB = publicIds.includes(linkB.id);
        const hasC = publicIds.includes(linkC.id);
        const hasD = publicIds.includes(linkD.id);

        log(`Link A (Always Active): ${hasA ? 'Visible' : 'Hidden'} (Expected: Visible)`);
        log(`Link B (Future): ${hasB ? 'Visible' : 'Hidden'} (Expected: Hidden)`);
        log(`Link C (Expired): ${hasC ? 'Visible' : 'Hidden'} (Expected: Hidden)`);
        log(`Link D (Active Window): ${hasD ? 'Visible' : 'Hidden'} (Expected: Visible)`);

        if (hasA && !hasB && !hasC && hasD) {
            log('✅ PASS: Public view filtering working correctly.');
        } else {
            log('❌ FAIL: Filtering logic incorrect.');
        }

        // 5. Cleanup
        log('\nCleaning up test links...');
        if (linkA) await linkService.deleteLink(linkA.id);
        if (linkB) await linkService.deleteLink(linkB.id);
        if (linkC) await linkService.deleteLink(linkC.id);
        if (linkD) await linkService.deleteLink(linkD.id);

        log('Done.');

    } catch (err) {
        log(`ERROR: ${err}`);
        console.error(err);
    } finally {
        const outPath = path.join(process.cwd(), 'verification_result.txt');
        fs.writeFileSync(outPath, logBuffer.join('\n'));
        console.log(`Log written to ${outPath}`);
    }
}

testLinkScheduling().catch(console.error);
