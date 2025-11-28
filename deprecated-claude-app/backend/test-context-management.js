#!/usr/bin/env node

/**
 * Test script for Context Management and Prompt Caching
 * This script tests the full flow from conversation creation to message processing
 */

const axios = require('axios');

const API_URL = 'http://localhost:3010/api';
const TOKEN = 'test-token'; // You'll need to get a real token

async function testContextManagement() {
  console.log('=== Testing Context Management Flow ===\n');
  
  try {
    // Step 1: Create a conversation with rolling window context management
    console.log('1. Creating conversation with rolling window context...');
    const createResponse = await axios.post(
      `${API_URL}/conversations`,
      {
        model: 'claude-3-opus-20240229',
        title: 'Context Management Test',
        settings: {
          temperature: 1.0,
          maxTokens: 1024
        }
      },
      {
        headers: { Authorization: `Bearer ${TOKEN}` }
      }
    );
    
    const conversationId = createResponse.data.id;
    console.log(`   ✅ Created conversation: ${conversationId}`);
    console.log(`   Initial contextManagement:`, createResponse.data.contextManagement);
    
    // Step 2: Update conversation with rolling window settings
    console.log('\n2. Updating conversation with rolling window settings...');
    const updateResponse = await axios.patch(
      `${API_URL}/conversations/${conversationId}`,
      {
        contextManagement: {
          strategy: 'rolling',
          maxTokens: 5000,
          maxGraceTokens: 1000,
          cacheMinTokens: 5000,
          cacheDepthFromEnd: 5
        }
      },
      {
        headers: { Authorization: `Bearer ${TOKEN}` }
      }
    );
    
    console.log(`   ✅ Updated conversation`);
    console.log(`   New contextManagement:`, updateResponse.data.contextManagement);
    
    // Step 3: Get the conversation to verify settings were saved
    console.log('\n3. Fetching conversation to verify settings...');
    const getResponse = await axios.get(
      `${API_URL}/conversations/${conversationId}`,
      {
        headers: { Authorization: `Bearer ${TOKEN}` }
      }
    );
    
    console.log(`   ✅ Retrieved conversation`);
    console.log(`   Stored contextManagement:`, getResponse.data.contextManagement);
    
    // Step 4: Add some messages to test the context window
    console.log('\n4. Adding test messages...');
    
    // We'll need to use WebSocket for actual messages, so let's at least verify the setup
    if (getResponse.data.contextManagement?.strategy === 'rolling') {
      console.log('   ✅ Rolling window strategy is configured');
      console.log('   Max tokens:', getResponse.data.contextManagement.maxTokens);
      console.log('   Grace tokens:', getResponse.data.contextManagement.maxGraceTokens);
    } else {
      console.log('   ❌ Rolling window strategy NOT configured!');
    }
    
    // Step 5: Test the context manager directly
    console.log('\n5. Testing context manager initialization...');
    const { ContextManager } = require('./dist/services/context-manager.js');
    const contextManager = new ContextManager();
    
    // Create mock messages
    const mockMessages = [];
    for (let i = 0; i < 50; i++) {
      mockMessages.push({
        id: `msg-${i}`,
        conversationId,
        branches: [{
          id: `branch-${i}`,
          content: `This is test message number ${i}. `.repeat(50), // ~250 chars = ~60 tokens
          role: i % 2 === 0 ? 'user' : 'assistant',
          createdAt: new Date()
        }],
        activeBranchId: `branch-${i}`,
        order: i
      });
    }
    
    // Test context preparation
    const mockConversation = {
      ...getResponse.data,
      contextManagement: {
        strategy: 'rolling',
        maxTokens: 500,
        maxGraceTokens: 100,
        cacheMinTokens: 200,
        cacheDepthFromEnd: 5
      }
    };
    
    const result = await contextManager.prepareContext(
      mockConversation,
      mockMessages
    );
    
    console.log('   Context window prepared:');
    console.log('   - Total messages provided:', mockMessages.length);
    console.log('   - Messages in window:', result.window.messages.length);
    console.log('   - Cacheable prefix:', result.window.cacheablePrefix.length);
    console.log('   - Active window:', result.window.activeWindow.length);
    console.log('   - Window start:', result.window.metadata.windowStart);
    console.log('   - Window end:', result.window.metadata.windowEnd);
    console.log('   - Total tokens:', result.window.metadata.totalTokens);
    
    if (result.window.messages.length < mockMessages.length) {
      console.log('   ✅ Rolling window truncation is working!');
    } else {
      console.log('   ❌ Rolling window truncation NOT working - all messages kept');
    }
    
    if (result.window.cacheablePrefix.length > 0) {
      console.log('   ✅ Cache prefix identified');
    } else {
      console.log('   ❌ No cache prefix identified');
    }
    
    console.log('\n=== Test Complete ===\n');
    
  } catch (error) {
    console.error('Test failed:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.error('\n⚠️  You need to provide a valid authentication token');
      console.error('   1. Start the app and login');
      console.error('   2. Check localStorage or network tab for the token');
      console.error('   3. Update the TOKEN variable in this script');
    }
  }
}

// Run the test
testContextManagement();
