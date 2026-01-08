#!/usr/bin/env node
/**
 * Diagnose import issues by running the parser logic directly
 */

const fs = require('fs');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node diagnose-import.js <conversation.json>');
  process.exit(1);
}

try {
  console.log('Reading file...');
  const content = fs.readFileSync(inputPath, 'utf-8');
  
  console.log('Parsing JSON...');
  const data = JSON.parse(content);
  
  console.log('\n=== Basic Structure ===');
  console.log('Keys:', Object.keys(data).join(', '));
  console.log('Messages:', data.messages?.length || 0);
  console.log('Participants:', data.participants?.length || 0);
  console.log('Conversation title:', data.conversation?.title);
  
  // Run the Arc Chat parser logic
  console.log('\n=== Running Arc Chat Parser ===');
  
  const conversation = data.conversation;
  const exportedMessages = data.messages || [];
  const participants = data.participants || [];
  
  // Check for messages with missing branches
  let messagesWithNoBranches = 0;
  let messagesWithEmptyBranches = 0;
  let branchesWithNoContent = 0;
  let branchesWithNoRole = 0;
  let invalidParentRefs = 0;
  
  // Build branch ID set for parent validation
  const allBranchIds = new Set();
  for (const msg of exportedMessages) {
    for (const branch of (msg.branches || [])) {
      if (branch.id) allBranchIds.add(branch.id);
    }
  }
  
  for (let i = 0; i < exportedMessages.length; i++) {
    const msg = exportedMessages[i];
    
    if (!msg.branches) {
      messagesWithNoBranches++;
      console.log(`  Message ${i}: missing branches array entirely`);
      continue;
    }
    
    if (msg.branches.length === 0) {
      messagesWithEmptyBranches++;
      console.log(`  Message ${i}: empty branches array`);
      continue;
    }
    
    for (let j = 0; j < msg.branches.length; j++) {
      const branch = msg.branches[j];
      
      if (branch.content === undefined || branch.content === null) {
        branchesWithNoContent++;
        console.log(`  Message ${i}, branch ${j}: content is ${branch.content}`);
      }
      
      if (!branch.role) {
        branchesWithNoRole++;
        console.log(`  Message ${i}, branch ${j}: no role`);
      }
      
      // Check parent reference
      if (branch.parentBranchId && branch.parentBranchId !== 'root') {
        if (!allBranchIds.has(branch.parentBranchId)) {
          invalidParentRefs++;
          console.log(`  Message ${i}, branch ${j}: invalid parentBranchId ${branch.parentBranchId}`);
        }
      }
    }
  }
  
  console.log('\n=== Summary ===');
  console.log(`Messages with no branches array: ${messagesWithNoBranches}`);
  console.log(`Messages with empty branches array: ${messagesWithEmptyBranches}`);
  console.log(`Branches with no content: ${branchesWithNoContent}`);
  console.log(`Branches with no role: ${branchesWithNoRole}`);
  console.log(`Invalid parent references: ${invalidParentRefs}`);
  
  // Try to simulate the tree sort
  console.log('\n=== Testing Tree Sort ===');
  
  const branchToMsgIndex = new Map();
  for (let i = 0; i < exportedMessages.length; i++) {
    for (const branch of (exportedMessages[i].branches || [])) {
      branchToMsgIndex.set(branch.id, i);
    }
  }
  
  const sortedIndices = [];
  const visited = new Set();
  const visiting = new Set();
  let cycleCount = 0;
  
  const visit = (msgIndex, depth = 0) => {
    if (depth > 1000) {
      console.log(`  WARNING: Depth exceeded at message ${msgIndex}`);
      return;
    }
    if (visited.has(msgIndex)) return;
    if (visiting.has(msgIndex)) {
      cycleCount++;
      return;
    }
    
    visiting.add(msgIndex);
    const msg = exportedMessages[msgIndex];
    
    for (const branch of (msg.branches || [])) {
      if (branch.parentBranchId && branch.parentBranchId !== 'root') {
        const parentMsgIndex = branchToMsgIndex.get(branch.parentBranchId);
        if (parentMsgIndex !== undefined && parentMsgIndex !== msgIndex) {
          visit(parentMsgIndex, depth + 1);
        }
      }
    }
    
    visiting.delete(msgIndex);
    visited.add(msgIndex);
    sortedIndices.push(msgIndex);
  };
  
  for (let i = 0; i < exportedMessages.length; i++) {
    visit(i);
  }
  
  console.log(`Cycles detected: ${cycleCount}`);
  console.log(`Messages sorted: ${sortedIndices.length}/${exportedMessages.length}`);
  
  if (sortedIndices.length !== exportedMessages.length) {
    console.log('WARNING: Some messages were not sorted!');
    const unsorted = [];
    for (let i = 0; i < exportedMessages.length; i++) {
      if (!visited.has(i)) unsorted.push(i);
    }
    console.log(`Unsorted message indices: ${unsorted.slice(0, 10).join(', ')}${unsorted.length > 10 ? '...' : ''}`);
  }
  
  // Try parsing a few messages like the real parser does
  console.log('\n=== Simulating Parse ===');
  let parseErrors = 0;
  
  for (let i = 0; i < Math.min(5, sortedIndices.length); i++) {
    const msgIndex = sortedIndices[i];
    const msg = exportedMessages[msgIndex];
    
    const activeBranch = msg.branches?.find(b => b.id === msg.activeBranchId) || msg.branches?.[0];
    
    if (activeBranch && activeBranch.content) {
      console.log(`  Message ${msgIndex}: role=${activeBranch.role}, content=${activeBranch.content.substring(0, 50)}...`);
    } else {
      console.log(`  Message ${msgIndex}: NO ACTIVE BRANCH or NO CONTENT`);
      parseErrors++;
    }
  }
  
  console.log(`\nParse simulation errors in first 5: ${parseErrors}`);
  
  console.log('\n✅ Diagnostic complete');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}



