#!/usr/bin/env node
/**
 * Strip debug data from conversation export to reduce file size
 */

const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath.replace('.json', '-stripped.json');

if (!inputPath) {
  console.error('Usage: node strip-debug.js <input.json> [output.json]');
  process.exit(1);
}

try {
  console.log('Reading', inputPath);
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  
  const originalSize = JSON.stringify(data).length;
  let debugFieldsRemoved = 0;
  
  // Strip debug fields from all branches
  for (const msg of (data.messages || [])) {
    for (const branch of (msg.branches || [])) {
      if (branch.debugRequest) {
        delete branch.debugRequest;
        debugFieldsRemoved++;
      }
      if (branch.debugResponse) {
        delete branch.debugResponse;
        debugFieldsRemoved++;
      }
    }
  }
  
  const newSize = JSON.stringify(data).length;
  
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  
  console.log('✅ Done!');
  console.log(`   Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   New size:      ${(newSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Reduction:     ${((1 - newSize/originalSize) * 100).toFixed(1)}%`);
  console.log(`   Debug fields removed: ${debugFieldsRemoved}`);
  console.log(`   Output: ${outputPath}`);
  
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}



