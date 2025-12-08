// Script to grant admin capability to a user by email
// Run with: node grant-admin.cjs <email>
// Example: node grant-admin.cjs lari@tesserae.cc

const { Database } = require('./dist/database/index.js');
const { v4: uuidv4 } = require('uuid');

async function grantAdmin() {
  const email = process.argv[2];
  
  if (!email) {
    console.log('Usage: node grant-admin.cjs <email>');
    console.log('Example: node grant-admin.cjs lari@tesserae.cc');
    process.exit(1);
  }
  
  const db = new Database();
  await db.init();
  
  const user = await db.getUserByEmail(email);
  
  if (!user) {
    console.log(`❌ User not found: ${email}`);
    process.exit(1);
  }
  
  console.log(`Found user: ${user.email} (${user.id})`);
  
  // Check if already admin
  const isAdmin = await db.userHasActiveGrantCapability(user.id, 'admin');
  if (isAdmin) {
    console.log('⚠️  User already has admin capability');
    process.exit(0);
  }
  
  // Grant admin capability
  await db.recordGrantCapability({
    id: uuidv4(),
    time: new Date().toISOString(),
    userId: user.id,
    action: 'granted',
    capability: 'admin',
    grantedByUserId: user.id // self-reference for script grants
  });
  
  console.log('✅ Granted admin capability');
  console.log(`\n🎉 ${email} is now an admin!`);
  
  process.exit(0);
}

grantAdmin().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

