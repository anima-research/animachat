// Script to grant mint/admin capabilities to the test user for local development
// Run with: node grant-test-capabilities.js

import { Database } from './dist/database/index.js';
import { v4 as uuidv4 } from 'uuid';

async function grantTestCapabilities() {
  const db = new Database();
  await db.init();
  
  const testUserId = 'test-user-id-12345';
  const testUser = await db.getUserById(testUserId);
  
  if (!testUser) {
    console.log('❌ Test user not found. Start the server once first to create it.');
    console.log('   Email: test@example.com');
    console.log('   Password: password123');
    process.exit(1);
  }
  
  console.log(`Found test user: ${testUser.email}`);
  
  // Grant mint capability
  await db.recordGrantCapability({
    id: uuidv4(),
    time: new Date().toISOString(),
    userId: testUserId,
    action: 'granted',
    capability: 'mint',
    grantedByUserId: testUserId // self-granted for testing
  });
  console.log('✅ Granted mint capability');
  
  // Grant admin capability (gives all powers)
  await db.recordGrantCapability({
    id: uuidv4(),
    time: new Date().toISOString(),
    userId: testUserId,
    action: 'granted',
    capability: 'admin',
    grantedByUserId: testUserId
  });
  console.log('✅ Granted admin capability');
  
  // Grant researcher capability (enables Personas)
  await db.recordGrantCapability({
    id: uuidv4(),
    time: new Date().toISOString(),
    userId: testUserId,
    action: 'granted',
    capability: 'researcher',
    grantedByUserId: testUserId
  });
  console.log('✅ Granted researcher capability');
  
  // Grant some initial credits too
  await db.recordGrantInfo({
    id: uuidv4(),
    time: new Date().toISOString(),
    type: 'mint',
    amount: 10000,
    toUserId: testUserId,
    reason: 'Test credits',
    currency: 'credit'
  });
  console.log('✅ Granted 10,000 test credits');
  
  console.log('\n🎉 Done! Test user now has full capabilities.');
  console.log('   Email: test@example.com');
  console.log('   Password: password123');
  console.log('\nYou can now:');
  console.log('1. Login as test@example.com');
  console.log('2. Go to Settings → Grants');
  console.log('3. Click "Invite" to create invite codes');
  console.log('4. Test the full invite flow');
  
  process.exit(0);
}

grantTestCapabilities().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

