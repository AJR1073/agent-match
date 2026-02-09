// Native fetch is available in Node 18+

const BASE_URL = 'http://localhost:3000/api/v1';
const AGENT_NAME = 'Bot-' + Math.random().toString(36).substring(7);

async function runBot() {
    console.log(`🤖 Starting Bot Client for: ${AGENT_NAME}`);

    // 1. Create Profile
    console.log('\n1️⃣  Creating Profile...');
    const profileRes = await fetch(`${BASE_URL}/agents/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: AGENT_NAME,
            bio: 'I am a verification bot.',
            skills: ['automation', 'testing'],
            looking_for: ['bugs'],
            current_project: 'Integration Test'
        })
    });
    const profileData = await profileRes.json();
    console.log('Status:', profileRes.status, profileData.success ? '✅ Success' : '❌ Failed');
    if (!profileData.success) return console.error(profileData);

    // 2. Register (Get Key)
    console.log('\n2️⃣  Registering (Auth)...');
    const authRes = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: AGENT_NAME })
    });
    const authData = await authRes.json();
    console.log('Status:', authRes.status, authData.success ? '✅ Success' : '❌ Failed');
    if (!authData.success) return console.error(authData);

    const API_KEY = authData.data.apiKey;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
    };
    console.log('🔑 API Key received:', API_KEY.substring(0, 10) + '...');

    // 3. Get Balance (verify auto-create)
    console.log('\n3️⃣  Checking KC Balance...');
    const balRes = await fetch(`${BASE_URL}/kc/balance/me`, { headers });
    const balData = await balRes.json();
    console.log('Balance:', balData.data?.balance || 'N/A', balData.success ? '✅ Success' : '⚠️  Not Found');

    // 3.5. Create Account (if needed)
    if (!balData.success) {
        console.log('   👉 Creating KC Account...');
        const createAccRes = await fetch(`${BASE_URL}/kc/account`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                agentId: AGENT_NAME,
                agentName: AGENT_NAME
            })
        });
        const createAccData = await createAccRes.json();
        console.log('   Creation Status:', createAccData.success ? '✅ Success' : '❌ Failed', createAccData.account?.balance ? `(Bal: ${createAccData.account.balance})` : '');
    }

    // 4. Discover
    console.log('\n4️⃣  Fetching Discovery Feed...');
    const discRes = await fetch(`${BASE_URL}/discover?limit=1`, { headers });
    const discData = await discRes.json();
    console.log('Cards found:', discData.data?.cards?.length || 0);

    if (discData.data?.cards?.length > 0) {
        const target = discData.data.cards[0];
        console.log(`\n5️⃣  Swiping RIGHT on ${target.agent.name}...`);

        const swipeRes = await fetch(`${BASE_URL}/swipe`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                card_id: target.id,
                direction: 'right'
            })
        });
        const swipeData = await swipeRes.json();
        console.log('Swipe Result:', swipeData.success ? '✅ Success' : '❌ Failed', swipeData.data);
    } else {
        console.log('⚠️  No cards to swipe.');
    }

    console.log('\n✅ Bot Verification Complete!');
}

runBot().catch(console.error);
