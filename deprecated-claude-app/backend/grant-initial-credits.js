// Script to grant initial credits to all existing users
// Reads initial grant amounts from config.json
const { Database } = require('./dist/database/index.js');
const { ConfigLoader } = require('./dist/config/loader.js');
const { v4: uuidv4 } = require('uuid');

async function grantInitialCredits() {
  const db = new Database();
  await db.init();
  
  const config = await ConfigLoader.getInstance().loadConfig();
  const initialGrants = config.initialGrants || {};
  
  if (Object.keys(initialGrants).length === 0) {
    console.log('No initialGrants configured in config.json');
    process.exit(0);
  }
  
  console.log('Initial grants from config:', initialGrants);
  console.log('\nLoading all users...');
  const users = await db.getAllUsers();
  console.log(`Found ${users.length} users`);
  
  for (const user of users) {
    console.log(`\nProcessing user: ${user.email} (${user.id})`);
    
    try {
      // Get current balances
      const summary = await db.getUserGrantSummary(user.id);
      
      // Grant each currency from config
      for (const [currency, targetAmount] of Object.entries(initialGrants)) {
        const currentAmount = Number(summary.totals[currency] || 0);
        console.log(`  Current ${currency}: ${currentAmount}`);
        
        if (currentAmount < targetAmount) {
          const amount = targetAmount - currentAmount;
          await db.recordGrantInfo({
            id: uuidv4(),
            time: new Date().toISOString(),
            type: 'mint',
            amount: amount,
            toUserId: user.id,
            reason: `Welcome credits: ${currency}`,
            currency: currency
          });
          console.log(`  ✅ Granted ${amount} ${currency} (total: ${targetAmount})`);
        } else {
          console.log(`  ⏭️  Already has enough ${currency}`);
        }
      }
      
    } catch (error) {
      console.error(`  ❌ Error processing user ${user.email}:`, error.message);
    }
  }
  
  console.log('\n✅ Initial credits granted to all users!');
  process.exit(0);
}

grantInitialCredits().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

