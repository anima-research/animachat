#!/usr/bin/env node
/**
 * Compact a conversation's event log to reduce file size
 * Usage: node compact-conversation.mjs <conversation-id-or-path>
 * 
 * This strips inline debugRequest/debugResponse (the 99% bloat) and removes
 * reconstructable events like active_branch_changed.
 */

import { createReadStream, createWriteStream } from 'fs';
import { stat, rename, unlink } from 'fs/promises';
import { createInterface } from 'readline';
import path from 'path';

async function compactConversation(filePath) {
  const fileStats = await stat(filePath);
  console.log(`\n📁 File: ${filePath}`);
  console.log(`📊 Original size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
  
  const tempPath = filePath + '.compacting';
  const outputStream = createWriteStream(tempPath, { encoding: 'utf-8' });
  
  let originalEvents = 0;
  let compactedEvents = 0;
  let strippedDebug = 0;
  let removedBranchChanged = 0;
  let removedOrderChanged = 0;
  
  await new Promise((resolve, reject) => {
    const inputStream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({
      input: inputStream,
      crlfDelay: Infinity
    });
    
    rl.on('line', (line) => {
      if (!line.trim()) return;
      originalEvents++;
      
      if (originalEvents % 1000 === 0) {
        process.stdout.write(`\rProcessed ${originalEvents} events...`);
      }
      
      try {
        const event = JSON.parse(line);
        
        // Remove reconstructable events
        if (event.type === 'active_branch_changed') {
          removedBranchChanged++;
          return;
        }
        if (event.type === 'message_order_changed') {
          removedOrderChanged++;
          return;
        }
        
        // Strip debug data from message_branch_updated
        if (event.type === 'message_branch_updated' && event.data?.updates) {
          if (event.data.updates.debugRequest) {
            delete event.data.updates.debugRequest;
            strippedDebug++;
          }
          if (event.data.updates.debugResponse) {
            delete event.data.updates.debugResponse;
            strippedDebug++;
          }
        }
        
        outputStream.write(JSON.stringify(event) + '\n');
        compactedEvents++;
      } catch (err) {
        // Keep unparseable lines
        outputStream.write(line + '\n');
        compactedEvents++;
      }
    });
    
    rl.on('close', () => {
      outputStream.end();
      resolve();
    });
    rl.on('error', reject);
    inputStream.on('error', reject);
  });
  
  await new Promise((resolve, reject) => {
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
  });
  
  // Backup original
  const backupPath = filePath + '.pre-compact.bak';
  await rename(filePath, backupPath);
  await rename(tempPath, filePath);
  
  const finalStats = await stat(filePath);
  const reduction = ((1 - finalStats.size / fileStats.size) * 100).toFixed(1);
  
  console.log(`\r${'='.repeat(60)}`);
  console.log(`✅ COMPACTION COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 Size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB → ${(finalStats.size / 1024 / 1024).toFixed(2)} MB (${reduction}% reduction)`);
  console.log(`📝 Events: ${originalEvents} → ${compactedEvents}`);
  console.log(`🗑️  Removed: ${removedBranchChanged} branch changes, ${removedOrderChanged} order changes`);
  console.log(`🔧 Stripped: ${strippedDebug} debug data entries`);
  console.log(`💾 Backup: ${backupPath}`);
  console.log(`${'='.repeat(60)}\n`);
}

// Main
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node compact-conversation.mjs <conversation-id-or-path>');
  console.error('Examples:');
  console.error('  node compact-conversation.mjs aaae13f6-2031-4e0c-8ff7-aa34ae9d34ac');
  console.error('  node compact-conversation.mjs /path/to/conversation.jsonl');
  process.exit(1);
}

// If it looks like a UUID, construct the path
let filePath = arg;
if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)) {
  const prefix1 = arg.substring(0, 2);
  const prefix2 = arg.substring(2, 4);
  filePath = `./data/conversations/${prefix1}/${prefix2}/${arg}.jsonl`;
}

compactConversation(filePath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

