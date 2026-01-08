#!/usr/bin/env node
/**
 * Import conversation using the raw messages endpoint (bypasses parser)
 * Usage: node import-raw.js <conversation.json> <server-url> <auth-token>
 * 
 * Example:
 *   node import-raw.js conversation.json http://localhost:3010 your-jwt-token
 */

const fs = require('fs');
const http = require('http');
const https = require('https');

const inputPath = process.argv[2];
const serverUrl = process.argv[3] || 'http://localhost:3010';
const authToken = process.argv[4];

if (!inputPath) {
  console.error('Usage: node import-raw.js <conversation.json> <server-url> <auth-token>');
  console.error('');
  console.error('Get your auth token from browser DevTools:');
  console.error('  1. Open browser DevTools (F12)');
  console.error('  2. Go to Application > Local Storage');
  console.error('  3. Copy the auth_token value');
  process.exit(1);
}

if (!authToken) {
  console.error('Auth token required. Get it from browser Local Storage.');
  process.exit(1);
}

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  try {
    console.log(`Reading ${inputPath}...`);
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const data = JSON.parse(raw);
    
    const conversationId = data.conversation?.id;
    if (!conversationId) {
      console.error('No conversation ID found in export');
      process.exit(1);
    }
    
    console.log(`Conversation ID: ${conversationId}`);
    console.log(`Messages: ${data.messages?.length}`);
    
    // First, check if the conversation exists on the server
    console.log('\nChecking if conversation exists...');
    const checkRes = await request('GET', `/api/conversations/${conversationId}`);
    
    if (checkRes.status === 404) {
      console.error('Conversation not found on server. You need to create it first or use the regular import.');
      process.exit(1);
    }
    
    if (checkRes.status !== 200) {
      console.error('Error checking conversation:', checkRes.data);
      process.exit(1);
    }
    
    console.log('Conversation exists, importing messages...');
    
    // Import via raw messages endpoint
    const importRes = await request('POST', '/api/import/messages-raw', {
      conversationId,
      messages: data.messages
    });
    
    if (importRes.status === 200) {
      console.log('✅ Import successful!');
      console.log('   Imported:', importRes.data.importedMessages, 'messages');
    } else {
      console.error('❌ Import failed:', importRes.data);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();



