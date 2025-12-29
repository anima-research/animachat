/**
 * Repair script for conversations with corrupted message orders
 * 
 * This fixes the bug where message splits didn't log order changes,
 * causing duplicate orders and orphaned messages.
 * 
 * Usage: npx ts-node scripts/repair-conversation-orders.ts <conversationId>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface Event {
  timestamp: string;
  type: string;
  data: any;
}

interface Message {
  id: string;
  order: number;
  branches: { id: string; parentBranchId?: string }[];
  activeBranchId: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data', 'conversations');

async function loadConversationEvents(conversationId: string): Promise<Event[]> {
  // Conversations are sharded by first 2 chars, then next 2 chars
  const shard1 = conversationId.substring(0, 2);
  const shard2 = conversationId.substring(2, 4);
  const eventFilePath = path.join(DATA_DIR, shard1, shard2, `${conversationId}.jsonl`);
  
  if (!fs.existsSync(eventFilePath)) {
    throw new Error(`Event file not found: ${eventFilePath}`);
  }
  
  const events: Event[] = [];
  const fileStream = fs.createReadStream(eventFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  for await (const line of rl) {
    if (line.trim()) {
      try {
        events.push(JSON.parse(line));
      } catch (e) {
        console.warn('Failed to parse line:', line.substring(0, 100));
      }
    }
  }
  
  return events;
}

function replayEventsToMessages(events: Event[]): Map<string, Message> {
  const messages = new Map<string, Message>();
  
  for (const event of events) {
    switch (event.type) {
      case 'message_created': {
        const msg = event.data;
        messages.set(msg.id, {
          id: msg.id,
          order: msg.order,
          branches: msg.branches || [],
          activeBranchId: msg.activeBranchId
        });
        break;
      }
      case 'message_branch_added': {
        const { messageId, branch } = event.data;
        const msg = messages.get(messageId);
        if (msg) {
          msg.branches.push(branch);
          msg.activeBranchId = branch.id;
        }
        break;
      }
      case 'active_branch_changed': {
        const { messageId, branchId } = event.data;
        const msg = messages.get(messageId);
        if (msg) {
          msg.activeBranchId = branchId;
        }
        break;
      }
      case 'message_deleted': {
        messages.delete(event.data.messageId);
        break;
      }
      case 'message_order_changed': {
        const { messageId, newOrder } = event.data;
        const msg = messages.get(messageId);
        if (msg) {
          msg.order = newOrder;
        }
        break;
      }
    }
  }
  
  return messages;
}

function findDuplicateOrders(messages: Map<string, Message>): Map<number, string[]> {
  const orderToMessages = new Map<number, string[]>();
  
  for (const [id, msg] of messages) {
    if (msg.order !== undefined) {
      const existing = orderToMessages.get(msg.order) || [];
      existing.push(id);
      orderToMessages.set(msg.order, existing);
    }
  }
  
  // Filter to only duplicates
  const duplicates = new Map<number, string[]>();
  for (const [order, ids] of orderToMessages) {
    if (ids.length > 1) {
      duplicates.set(order, ids);
    }
  }
  
  return duplicates;
}

function buildBranchToMessageMap(messages: Map<string, Message>): Map<string, string> {
  const branchToMessage = new Map<string, string>();
  for (const [id, msg] of messages) {
    for (const branch of msg.branches) {
      branchToMessage.set(branch.id, id);
    }
  }
  return branchToMessage;
}

function computeCorrectOrders(messages: Map<string, Message>): Map<string, number> {
  const branchToMessage = buildBranchToMessageMap(messages);
  const correctOrders = new Map<string, number>();
  
  // Find root messages (branches with no parent or parent not in our messages)
  const roots: string[] = [];
  for (const [id, msg] of messages) {
    const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
    if (!activeBranch?.parentBranchId || !branchToMessage.has(activeBranch.parentBranchId)) {
      roots.push(id);
    }
  }
  
  // Sort roots by their current order
  roots.sort((a, b) => (messages.get(a)?.order || 0) - (messages.get(b)?.order || 0));
  
  // Build the tree structure
  const childrenOf = new Map<string, string[]>();
  for (const [id, msg] of messages) {
    for (const branch of msg.branches) {
      if (branch.parentBranchId && branchToMessage.has(branch.parentBranchId)) {
        const parentMsgId = branchToMessage.get(branch.parentBranchId)!;
        const children = childrenOf.get(parentMsgId) || [];
        if (!children.includes(id)) {
          children.push(id);
        }
        childrenOf.set(parentMsgId, children);
      }
    }
  }
  
  // For each message, find its path from root and compute order
  function computeOrderForPath(startId: string, startOrder: number): void {
    correctOrders.set(startId, startOrder);
    
    // Get children sorted by their current order (to preserve original intent)
    const children = childrenOf.get(startId) || [];
    children.sort((a, b) => (messages.get(a)?.order || 0) - (messages.get(b)?.order || 0));
    
    // Each child gets the next order in sequence
    // But we need to handle branching - siblings should all be "after" the parent
    let nextOrder = startOrder + 1;
    for (const childId of children) {
      if (!correctOrders.has(childId)) {
        computeOrderForPath(childId, nextOrder);
        // Find the max order in this subtree to continue from
        let maxInSubtree = nextOrder;
        for (const [id, order] of correctOrders) {
          if (order > maxInSubtree) {
            // Check if this is in the subtree of childId
            // For simplicity, just find the max
            maxInSubtree = order;
          }
        }
        nextOrder = maxInSubtree + 1;
      }
    }
  }
  
  let currentOrder = 0;
  for (const rootId of roots) {
    computeOrderForPath(rootId, currentOrder);
    // Find max order so far
    for (const order of correctOrders.values()) {
      if (order >= currentOrder) {
        currentOrder = order + 1;
      }
    }
  }
  
  return correctOrders;
}

function generateRepairEvents(
  messages: Map<string, Message>,
  correctOrders: Map<string, number>,
  conversationId: string
): Event[] {
  const repairEvents: Event[] = [];
  const now = new Date().toISOString();
  
  for (const [messageId, newOrder] of correctOrders) {
    const msg = messages.get(messageId);
    if (msg && msg.order !== newOrder) {
      repairEvents.push({
        timestamp: now,
        type: 'message_order_changed',
        data: {
          messageId,
          oldOrder: msg.order,
          newOrder,
          conversationId,
          repairReason: 'Fixed duplicate order from split bug'
        }
      });
    }
  }
  
  return repairEvents;
}

async function appendEventsToFile(conversationId: string, events: Event[]): Promise<void> {
  const shard1 = conversationId.substring(0, 2);
  const shard2 = conversationId.substring(2, 4);
  const eventFilePath = path.join(DATA_DIR, shard1, shard2, `${conversationId}.jsonl`);
  
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(eventFilePath, lines);
}

async function main() {
  const conversationId = process.argv[2];
  
  if (!conversationId) {
    console.error('Usage: npx ts-node scripts/repair-conversation-orders.ts <conversationId>');
    process.exit(1);
  }
  
  console.log(`\n🔧 Repairing conversation: ${conversationId}\n`);
  
  // Load events
  console.log('Loading events...');
  const events = await loadConversationEvents(conversationId);
  console.log(`  Loaded ${events.length} events`);
  
  // Replay to get current state
  console.log('Replaying events...');
  const messages = replayEventsToMessages(events);
  console.log(`  Found ${messages.size} messages`);
  
  // Find duplicates
  console.log('Checking for duplicate orders...');
  const duplicates = findDuplicateOrders(messages);
  if (duplicates.size === 0) {
    console.log('  ✅ No duplicate orders found! Conversation is healthy.');
    return;
  }
  
  console.log(`  ⚠️  Found ${duplicates.size} duplicate orders:`);
  for (const [order, ids] of duplicates) {
    console.log(`    Order ${order}: ${ids.join(', ')}`);
  }
  
  // Compute correct orders
  console.log('\nComputing correct orders...');
  const correctOrders = computeCorrectOrders(messages);
  
  // Generate repair events
  const repairEvents = generateRepairEvents(messages, correctOrders, conversationId);
  
  if (repairEvents.length === 0) {
    console.log('  No repairs needed.');
    return;
  }
  
  console.log(`\n📝 Order changes to apply (${repairEvents.length} total):`);
  for (const event of repairEvents) {
    console.log(`  Message ${event.data.messageId.substring(0, 8)}: ${event.data.oldOrder} → ${event.data.newOrder}`);
  }
  
  // Confirm
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise<string>(resolve => {
    rl.question('\nApply these repairs? (yes/no): ', resolve);
  });
  rl.close();
  
  if (answer.toLowerCase() !== 'yes') {
    console.log('Aborted.');
    return;
  }
  
  // Apply repairs
  console.log('\nApplying repairs...');
  await appendEventsToFile(conversationId, repairEvents);
  console.log('  ✅ Repairs applied! Restart the server to see changes.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});



