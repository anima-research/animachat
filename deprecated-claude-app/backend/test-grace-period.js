import { RollingContextStrategy } from './src/services/context-strategies.js';

// Test configuration
const config = {
  strategy: 'rolling',
  maxTokens: 1000,
  maxGraceTokens: 500,
  cacheMinTokens: 100,
  cacheDepthFromEnd: 5
};

const strategy = new RollingContextStrategy(config);

// Helper to create a test message
function createMessage(id, content, tokens = null) {
  const actualTokens = tokens || Math.ceil(content.length / 4);
  return {
    id: `msg-${id}`,
    content,
    role: 'user',
    branches: [{
      id: `branch-${id}`,
      content,
      role: 'user'
    }],
    activeBranchId: `branch-${id}`,
    _estimatedTokens: actualTokens
  };
}

// Simulate conversation growth
const messages = [];
let messageId = 1;

console.log('\n🧪 Testing Rolling Window with Grace Period\n');
console.log(`Config: maxTokens=${config.maxTokens}, graceTokens=${config.maxGraceTokens}`);
console.log('=' .repeat(60));

// Phase 1: Build up to near maxTokens
console.log('\n📈 Phase 1: Building up context...');
for (let i = 0; i < 8; i++) {
  const msg = createMessage(messageId++, 'x'.repeat(400), 100); // 100 tokens each
  messages.push(msg);
  
  const result = strategy.prepareContext(messages);
  console.log(`Message ${i+1}: ${result.metadata.totalTokens} tokens, ${result.messages.length} messages kept`);
}

// Phase 2: Enter grace period (should NOT rotate yet)
console.log('\n⏸️  Phase 2: Entering grace period (should append, not rotate)...');
for (let i = 0; i < 4; i++) {
  const msg = createMessage(messageId++, 'x'.repeat(400), 100);
  messages.push(msg);
  
  const result = strategy.prepareContext(messages);
  const status = result.metadata.droppedMessages > 0 ? '🔄 ROTATED' : '✅ APPENDED';
  console.log(`Message ${messages.length}: ${result.metadata.totalTokens} tokens, ${status}`);
}

// Phase 3: Exceed grace period (should rotate)
console.log('\n🔄 Phase 3: Exceeding grace period (should rotate)...');
for (let i = 0; i < 3; i++) {
  const msg = createMessage(messageId++, 'x'.repeat(400), 100);
  messages.push(msg);
  
  const result = strategy.prepareContext(messages);
  const status = result.metadata.droppedMessages > 0 ? '🔄 ROTATED' : '✅ APPENDED';
  console.log(`Message ${messages.length}: ${result.metadata.totalTokens} tokens, ${status}`);
  
  if (result.metadata.droppedMessages > 0) {
    console.log(`   └─ Dropped ${result.metadata.droppedMessages} messages`);
  }
}

// Phase 4: After rotation, should be back in normal mode
console.log('\n📊 Phase 4: After rotation (should be in new cycle)...');
for (let i = 0; i < 3; i++) {
  const msg = createMessage(messageId++, 'x'.repeat(400), 100);
  messages.push(msg);
  
  const result = strategy.prepareContext(messages);
  const status = result.metadata.droppedMessages > 0 ? '🔄 ROTATED' : '✅ APPENDED';
  console.log(`Message ${messages.length}: ${result.metadata.totalTokens} tokens, ${status}`);
}

console.log('\n✅ Test complete!\n');
