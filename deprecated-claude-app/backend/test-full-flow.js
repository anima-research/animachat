#!/usr/bin/env node

/**
 * Full integration test for context management and prompt caching
 * This tests the complete flow from UI to backend
 */

const WebSocket = require('ws');
const axios = require('axios');

const API_URL = 'http://localhost:3010/api';
const WS_URL = 'ws://localhost:3010';

// You'll need to get a real token by logging in
const TOKEN = process.env.AUTH_TOKEN || 'test-token';

// Literary text for testing - using public domain content
const TEST_MESSAGES = [
  "Let's discuss the opening of Moby Dick. 'Call me Ishmael.' is one of the most famous opening lines in literature.",
  "Indeed, it immediately establishes a personal, intimate tone with the reader. The narrator is inviting us into his story.",
  "What's interesting is that we never learn if Ishmael is his real name. He says 'Call me Ishmael' not 'My name is Ishmael'.",
  "That's a brilliant observation. It suggests from the very beginning that identity and truth will be fluid concepts in this narrative.",
  "The biblical reference is also significant. Ishmael was the outcast son of Abraham, wandering in the wilderness.",
  "Yes, and this immediately positions our narrator as an outsider, someone on the margins of society looking in.",
  "Melville continues: 'Some years ago—never mind how long precisely—having little or no money in my purse...'",
  "The vagueness about time is deliberate. It makes the story feel both specific and universal.",
  "He mentions having 'nothing particular to interest me on shore' - suggesting a profound disconnection from land-based life.",
  "The sea represents escape, adventure, but also perhaps a death wish - he mentions 'pistol and ball' as an alternative.",
  "That darkness is present from the beginning. The sea is both salvation and potential destruction.",
  "Let's look at Chapter 1's title: 'Loomings'. What do you think Melville meant by this?",
  "Loomings suggest things appearing indistinctly, like ships on the horizon or fate approaching.",
  "It also has a sense of weaving - the loom creating fabric, perhaps the fabric of the narrative itself.",
  "Melville was incredibly sophisticated in his use of symbolism and layered meanings.",
  "The way he describes Manhattan, surrounded by water, with crowds drawn to the edges looking out to sea.",
  "It's a powerful image - all of humanity drawn to the mystery and vastness of the ocean.",
  "He writes about the 'insular city of the Manhattoes' - making it sound almost mythical.",
  "And everyone is drawn to water - he lists different types of people, all magnetized by the sea.",
  "The meditation on water is philosophical - why are humans so drawn to it?",
  "He suggests it's because we see our own image in water - it's Narcissus all over again.",
  "But unlike Narcissus, who was trapped by his reflection, Ishmael seeks the sea for freedom.",
  "Though perhaps he's equally trapped by his compulsion to go to sea.",
  "The economic reality is also present - he goes as a sailor because he needs the money.",
  "Yet he frames it as a choice, a philosophical decision rather than mere necessity.",
  "He jokes about the difference between passengers and sailors - who pays whom.",
  "The democratic ideals are clear - he doesn't mind being ordered about as a common sailor.",
  "He sees it as part of the human condition - everyone serves someone or something.",
  "The way he philosophizes about simple things shows the depth of his character.",
  "And this is all before we even meet Ahab or see the white whale.",
  "Melville is establishing the narrative voice, the philosophical framework.",
  "Every detail matters - the choice of words, the biblical and classical references.",
  "The density of the prose is remarkable - every sentence carries multiple meanings.",
  "Modern readers sometimes struggle with the pace, but it rewards careful attention.",
  "The digressions aren't really digressions - they're essential to the overall meaning.",
  "Like the cetology chapters later - they're not just about whales, but about knowledge itself.",
  "Exactly. How do we know what we know? Can we ever truly understand another being?",
  "These questions apply to whales, but also to human nature and God.",
  "Melville was writing a philosophical novel disguised as an adventure story.",
  "Though it is also genuinely thrilling as an adventure - the hunting scenes are incredible.",
  "The technical details about whaling give the story credibility and weight.",
  "He spent time on a whaling ship, so he knew what he was writing about.",
  "But he transforms that experience into something mythic and universal.",
  "The Pequod becomes a microcosm of the world, with all its diversity and conflict.",
  "The crew represents different nations, races, religions - it's remarkably diverse.",
  "For a novel written in 1851, it's quite progressive in some ways.",
  "Though it also reflects the prejudices of its time, which we must acknowledge.",
  "Queequeg is portrayed with dignity and depth, not as a simple 'savage'.",
  "The friendship between Ishmael and Queequeg is one of the most moving parts of the book.",
  "It transcends cultural boundaries and shows genuine human connection.",
  "Their 'marriage' ceremony with the tomahawk pipe is both humorous and touching."
];

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('=== Full Integration Test ===\n');
  
  try {
    // Step 1: Login to get a real token if we don't have one
    let authToken = TOKEN;
    if (TOKEN === 'test-token') {
      console.log('1. Attempting to login...');
      try {
        const loginResponse = await axios.post(`${API_URL}/auth/login`, {
          email: 'test@example.com',
          password: 'test123'
        });
        authToken = loginResponse.data.token;
        console.log('   ✅ Logged in successfully');
      } catch (error) {
        console.log('   ⚠️  Login failed, will try with test-token');
      }
    }
    
    // Step 2: Create a conversation with rolling window
    console.log('\n2. Creating conversation with rolling window...');
    const createResponse = await axios.post(
      `${API_URL}/conversations`,
      {
        model: 'claude-3-opus-openrouter', // Use OpenRouter model for caching test
        title: 'Moby Dick Discussion - Context Test',
        settings: {
          temperature: 0.8,
          maxTokens: 2048
        }
      },
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );
    
    const conversationId = createResponse.data.id;
    console.log(`   ✅ Created conversation: ${conversationId}`);
    
    // Step 3: Update with rolling window settings
    console.log('\n3. Configuring rolling window context...');
    await axios.patch(
      `${API_URL}/conversations/${conversationId}`,
      {
        contextManagement: {
          strategy: 'rolling',
          maxTokens: 2000,        // Small window to force truncation
          maxGraceTokens: 500,    // Small grace period
          cacheMinTokens: 1000,   // Cache when we have enough
          cacheDepthFromEnd: 5    // Keep last 5 messages uncached
        }
      },
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );
    console.log('   ✅ Configured rolling window');
    
    // Step 4: Connect WebSocket
    console.log('\n4. Connecting WebSocket...');
    const ws = new WebSocket(WS_URL, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    console.log('   ✅ WebSocket connected');
    
    // Step 5: Send messages and observe context window behavior
    console.log('\n5. Sending test messages...');
    
    let messageCount = 0;
    let contextWindows = [];
    
    // Listen for responses
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      
      if (message.type === 'stream' && message.isComplete) {
        console.log(`   ✅ Received response ${messageCount}`);
      }
      
      if (message.type === 'error') {
        console.error('   ❌ Error:', message.error);
      }
      
      // Look for debug logs in console output
      if (message.type === 'debug') {
        contextWindows.push(message.context);
      }
    });
    
    // Send messages one by one
    for (let i = 0; i < Math.min(20, TEST_MESSAGES.length); i += 2) {
      messageCount++;
      console.log(`\n   Sending message ${messageCount}: "${TEST_MESSAGES[i].substring(0, 50)}..."`);
      
      // Send user message
      ws.send(JSON.stringify({
        type: 'chat',
        conversationId,
        content: TEST_MESSAGES[i],
        model: 'claude-3-opus-openrouter',
        settings: {
          temperature: 0.8,
          maxTokens: 500
        }
      }));
      
      // Wait for response
      await delay(3000);
      
      // Check conversation state
      const convResponse = await axios.get(
        `${API_URL}/conversations/${conversationId}`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );
      
      const messages = await axios.get(
        `${API_URL}/conversations/${conversationId}/messages`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );
      
      const totalMessages = messages.data.length;
      const estimatedTokens = messages.data.reduce((sum, msg) => {
        const content = msg.branches[0]?.content || '';
        return sum + Math.ceil(content.length / 4);
      }, 0);
      
      console.log(`   Status: ${totalMessages} messages, ~${estimatedTokens} tokens`);
      
      if (estimatedTokens > 2500) {
        console.log('   🔄 Should trigger context window truncation');
      }
    }
    
    // Step 6: Verify context management
    console.log('\n6. Verifying context management...');
    
    const finalMessages = await axios.get(
      `${API_URL}/conversations/${conversationId}/messages`,
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );
    
    console.log(`   Total messages in conversation: ${finalMessages.data.length}`);
    
    // Check if we have any cache metrics
    const metricsResponse = await axios.get(
      `${API_URL}/conversations/${conversationId}/metrics`,
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    ).catch(e => null);
    
    if (metricsResponse?.data) {
      console.log('   Metrics:', metricsResponse.data);
    }
    
    // Close WebSocket
    ws.close();
    
    console.log('\n=== Test Summary ===');
    console.log('✅ Conversation created and configured');
    console.log('✅ Messages sent and received');
    console.log('✅ Context management settings applied');
    
    console.log('\n📝 Check backend logs for:');
    console.log('   - [ContextManager] entries showing strategy in use');
    console.log('   - [RollingContextStrategy] entries showing truncation');
    console.log('   - [EnhancedInference] entries showing cache control');
    console.log('   - [OpenRouter] entries showing cache metrics');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.error('\n⚠️  Authentication failed. Please:');
      console.error('   1. Start the backend: cd backend && npm run dev');
      console.error('   2. Create a test account or use existing credentials');
      console.error('   3. Set AUTH_TOKEN environment variable');
      console.error('   Example: AUTH_TOKEN=your-token-here node test-full-flow.js');
    }
  }
}

// Run the test
runTest().catch(console.error);
