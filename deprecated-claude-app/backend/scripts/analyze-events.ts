#!/usr/bin/env npx ts-node
/**
 * Analyze event distribution in a conversation's event log
 * Usage: npx ts-node scripts/analyze-events.ts <path-to-jsonl-file>
 */

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { createInterface } from 'readline';

interface EventStats {
  count: number;
  totalBytes: number;
  minBytes: number;
  maxBytes: number;
  examples: string[];
}

async function analyzeEvents(filePath: string) {
  const fileStats = await stat(filePath);
  console.log(`\n📁 File: ${filePath}`);
  console.log(`📊 Total size: ${(fileStats.size / 1024 / 1024 / 1024).toFixed(2)} GB (${fileStats.size.toLocaleString()} bytes)\n`);
  
  const eventTypeStats = new Map<string, EventStats>();
  let totalEvents = 0;
  let totalBytes = 0;
  let lineNumber = 0;
  let parseErrors = 0;
  
  return new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity
    });
    
    rl.on('line', (line) => {
      lineNumber++;
      if (!line.trim()) return;
      
      const lineBytes = Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
      totalBytes += lineBytes;
      totalEvents++;
      
      try {
        const event = JSON.parse(line);
        const eventType = event.type || 'unknown';
        
        const existing = eventTypeStats.get(eventType) || {
          count: 0,
          totalBytes: 0,
          minBytes: Infinity,
          maxBytes: 0,
          examples: []
        };
        
        existing.count++;
        existing.totalBytes += lineBytes;
        existing.minBytes = Math.min(existing.minBytes, lineBytes);
        existing.maxBytes = Math.max(existing.maxBytes, lineBytes);
        
        // Keep a few examples of each type
        if (existing.examples.length < 3) {
          existing.examples.push(line.substring(0, 200) + (line.length > 200 ? '...' : ''));
        }
        
        eventTypeStats.set(eventType, existing);
        
        // Progress indicator every 100k events
        if (totalEvents % 100000 === 0) {
          process.stdout.write(`\rProcessed ${totalEvents.toLocaleString()} events...`);
        }
      } catch (e) {
        parseErrors++;
        if (parseErrors <= 5) {
          console.error(`\nParse error on line ${lineNumber}: ${e}`);
        }
      }
    });
    
    rl.on('close', () => {
      console.log(`\rProcessed ${totalEvents.toLocaleString()} events total\n`);
      
      if (parseErrors > 0) {
        console.log(`⚠️  Parse errors: ${parseErrors}\n`);
      }
      
      // Sort by total bytes (largest first)
      const sortedByBytes = [...eventTypeStats.entries()]
        .sort((a, b) => b[1].totalBytes - a[1].totalBytes);
      
      console.log('=' .repeat(100));
      console.log('📈 EVENT TYPES BY SIZE (largest first)');
      console.log('=' .repeat(100));
      console.log(`${'Event Type'.padEnd(45)} ${'Count'.padStart(12)} ${'Total Size'.padStart(15)} ${'% of File'.padStart(10)} ${'Avg Size'.padStart(12)}`);
      console.log('-'.repeat(100));
      
      for (const [eventType, stats] of sortedByBytes) {
        const pctOfFile = ((stats.totalBytes / totalBytes) * 100).toFixed(1);
        const avgSize = Math.round(stats.totalBytes / stats.count);
        const totalSizeMB = (stats.totalBytes / 1024 / 1024).toFixed(2);
        
        console.log(
          `${eventType.padEnd(45)} ${stats.count.toLocaleString().padStart(12)} ${(totalSizeMB + ' MB').padStart(15)} ${(pctOfFile + '%').padStart(10)} ${(avgSize + ' B').padStart(12)}`
        );
      }
      
      console.log('=' .repeat(100));
      console.log(`${'TOTAL'.padEnd(45)} ${totalEvents.toLocaleString().padStart(12)} ${((totalBytes / 1024 / 1024).toFixed(2) + ' MB').padStart(15)} ${'100.0%'.padStart(10)}`);
      console.log('=' .repeat(100));
      
      // Recommendations
      console.log('\n📋 COMPACTION RECOMMENDATIONS:');
      console.log('-'.repeat(60));
      
      const activeBranchChangedStats = eventTypeStats.get('active_branch_changed');
      if (activeBranchChangedStats) {
        const savingsMB = (activeBranchChangedStats.totalBytes / 1024 / 1024).toFixed(2);
        const savingsPct = ((activeBranchChangedStats.totalBytes / totalBytes) * 100).toFixed(1);
        console.log(`✂️  Removing 'active_branch_changed': Save ${savingsMB} MB (${savingsPct}%)`);
      }
      
      const messageOrderChangedStats = eventTypeStats.get('message_order_changed');
      if (messageOrderChangedStats) {
        const savingsMB = (messageOrderChangedStats.totalBytes / 1024 / 1024).toFixed(2);
        const savingsPct = ((messageOrderChangedStats.totalBytes / totalBytes) * 100).toFixed(1);
        console.log(`✂️  Removing 'message_order_changed': Save ${savingsMB} MB (${savingsPct}%)`);
      }
      
      // Show examples of largest event types
      console.log('\n📝 SAMPLE EVENTS (first 3 of each type):');
      console.log('-'.repeat(60));
      for (const [eventType, stats] of sortedByBytes.slice(0, 5)) {
        console.log(`\n[${eventType}] (${stats.count} events, avg ${Math.round(stats.totalBytes / stats.count)} bytes):`);
        for (const example of stats.examples) {
          console.log(`  ${example}`);
        }
      }
      
      resolve();
    });
    
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

// Main
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx ts-node scripts/analyze-events.ts <path-to-jsonl-file>');
  process.exit(1);
}

analyzeEvents(filePath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

