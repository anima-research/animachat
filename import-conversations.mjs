#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_BASE = 'http://localhost:3010/api';
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'testpassword123';
const TEST_NAME = 'Test User';

// Helper to make API calls
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.token && { 'Authorization': `Bearer ${options.token}` }),
      ...options.headers
    },
    ...options
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API call failed: ${response.status} ${response.statusText} - ${error}`);
  }
  
  return response.json();
}

// Register or login user
async function getAuthToken() {
  try {
    // Try to login first
    const loginResult = await apiCall('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD
      })
    });
    console.log('✅ Logged in as existing user');
    return loginResult.token;
  } catch (error) {
    // If login fails, try to register
    try {
      const registerResult = await apiCall('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          name: TEST_NAME
        })
      });
      console.log('✅ Registered new user');
      return registerResult.token;
    } catch (regError) {
      console.error('❌ Failed to register:', regError.message);
      throw regError;
    }
  }
}

// Import a conversation file
async function importConversation(token, filePath) {
  console.log(`\n📥 Importing ${filePath}...`);
  
  const fileContent = readFileSync(filePath, 'utf-8');
  const conversationData = JSON.parse(fileContent);
  
  // Use the arc_chat format
  const importRequest = {
    format: 'arc_chat',
    content: fileContent,
    title: conversationData.conversation?.title || 'Imported Conversation',
    conversationFormat: conversationData.conversation?.format || 'standard'
  };
  
  try {
    const result = await apiCall('/import/execute', {
      method: 'POST',
      token,
      body: JSON.stringify(importRequest)
    });
    
    console.log(`✅ Successfully imported conversation: ${result.conversationId}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to import ${filePath}:`, error.message);
    throw error;
  }
}

// Main function
async function main() {
  console.log('🚀 Starting conversation import...\n');
  
  // Get auth token
  const token = await getAuthToken();
  
  // Import all conversation files
  const conversationsDir = join(__dirname, 'tesst-convos');
  const files = [
    'conversation-1c2e304d-1f7f-4484-8d24-75b5b951eb60.json',
    'conversation-5787b16b-b45f-45d3-ad37-07384279337d.json',
    'conversation-ccdee88c-0329-4cc0-b1ed-9a273f252331.json'
  ];
  
  const results = [];
  for (const file of files) {
    const filePath = join(conversationsDir, file);
    try {
      const result = await importConversation(token, filePath);
      results.push({ file, success: true, conversationId: result.conversationId });
    } catch (error) {
      results.push({ file, success: false, error: error.message });
    }
  }
  
  // Summary
  console.log('\n📊 Import Summary:');
  console.log('='.repeat(50));
  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.file} -> ${result.conversationId}`);
    } else {
      console.log(`❌ ${result.file} -> ${result.error}`);
    }
  }
  console.log('='.repeat(50));
  
  const successCount = results.filter(r => r.success).length;
  console.log(`\n✨ Imported ${successCount}/${files.length} conversations successfully!`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
