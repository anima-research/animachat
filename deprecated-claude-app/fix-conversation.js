#!/usr/bin/env node
/**
 * Removes messages after a specified timestamp from a conversation JSON.
 * Usage: node fix-conversation.js <input.json> [output.json]
 */

const fs = require('fs');

// Cutoff in UTC (JSON timestamps use Z suffix = UTC)
const CUTOFF = new Date('2025-12-28T03:00:00Z').getTime();

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath.replace('.json', '-fixed.json');

if (!inputPath) {
  console.error('Usage: node fix-conversation.js <input.json> [output.json]');
  process.exit(1);
}

try {
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(raw);
  
  let originalBranchCount = 0;
  let removedBranchCount = 0;
  
  // Filter branches within messages by timestamp
  if (data.messages && Array.isArray(data.messages)) {
    for (const msg of data.messages) {
      if (msg.branches && Array.isArray(msg.branches)) {
        originalBranchCount += msg.branches.length;
        
        msg.branches = msg.branches.filter(branch => {
          const timestamp = branch.createdAt || branch.timestamp || branch.created_at;
          if (!timestamp) return true; // Keep branches without timestamp (safer)
          
          const branchTime = new Date(timestamp).getTime();
          const keep = branchTime <= CUTOFF;
          if (!keep) {
            console.log(`  Removing branch from ${timestamp}`);
          }
          return keep;
        });
      }
    }
    
    // Remove messages that have no branches left
    const beforeMsgCount = data.messages.length;
    data.messages = data.messages.filter(msg => 
      !msg.branches || msg.branches.length > 0
    );
    const afterMsgCount = data.messages.length;
    
    // Count remaining branches
    let newBranchCount = 0;
    for (const msg of data.messages) {
      newBranchCount += msg.branches?.length || 0;
    }
    removedBranchCount = originalBranchCount - newBranchCount;
    
    console.log(`   Messages: ${beforeMsgCount} -> ${afterMsgCount} (removed ${beforeMsgCount - afterMsgCount} empty)`);
  }
  
  const removed = removedBranchCount;
  
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  
  console.log(`✅ Done!`);
  console.log(`   Branches removed:  ${removed}`);
  console.log(`   Output: ${outputPath}`);
  
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

