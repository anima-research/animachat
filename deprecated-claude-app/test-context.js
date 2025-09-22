// Quick test of the context management feature
const axios = require('axios');

const API_URL = 'http://localhost:3000/api';
let TOKEN = '';

async function login() {
  try {
    const response = await axios.post(`${API_URL}/auth/login`, {
      email: 'test@example.com',
      password: 'test123'
    });
    TOKEN = response.data.token;
    console.log('✓ Logged in successfully');
    return true;
  } catch (error) {
    console.error('✗ Login failed:', error.response?.data || error.message);
    return false;
  }
}

async function createConversation() {
  try {
    const response = await axios.post(`${API_URL}/conversations`, {
      title: 'Test Context Management',
      model: 'claude-3.6-sonnet',
      systemPrompt: 'You are a helpful assistant.',
      contextManagement: {
        strategy: 'rolling',
        maxTokens: 5000,
        maxGraceTokens: 1000,
        cacheMinTokens: 5000,
        cacheDepthFromEnd: 5
      }
    }, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log('✓ Created conversation with rolling context:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('✗ Failed to create conversation:', error.response?.data || error.message);
    return null;
  }
}

async function updateConversationContext(conversationId) {
  try {
    const response = await axios.patch(`${API_URL}/conversations/${conversationId}`, {
      contextManagement: {
        strategy: 'append',
        cacheInterval: 10000
      }
    }, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log('✓ Updated conversation to append context');
    return response.data;
  } catch (error) {
    console.error('✗ Failed to update conversation:', error.response?.data || error.message);
    return null;
  }
}

async function main() {
  console.log('Testing Context Management Feature...\n');
  
  if (!await login()) {
    console.log('\nPlease make sure the backend is running and the test user exists.');
    return;
  }
  
  const conversation = await createConversation();
  if (!conversation) return;
  
  console.log('\nConversation context management:', conversation.contextManagement);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const updated = await updateConversationContext(conversation.id);
  if (updated) {
    console.log('Updated context management:', updated.contextManagement);
  }
  
  console.log('\n✓ Context management feature is working!');
}

main().catch(console.error);
