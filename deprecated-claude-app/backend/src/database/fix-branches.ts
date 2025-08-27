import { Database } from './index.js';

/**
 * Utility to fix branch structure issues in conversations
 * This can be run manually to repair corrupted conversation trees
 */
export async function fixConversationBranches(db: Database, conversationId: string): Promise<void> {
  console.log(`[Branch Fix] Starting fix for conversation: ${conversationId}`);
  
  const messages = await db.getConversationMessages(conversationId);
  let fixCount = 0;
  
  for (const message of messages) {
    // Check if branches have inconsistent parent IDs
    const parentIds = new Set(message.branches.map(b => b.parentBranchId));
    
    if (parentIds.size > 1) {
      console.log(`[Branch Fix] Found message with mixed parent IDs: ${message.id}`);
      console.log(`[Branch Fix] Parent IDs found:`, Array.from(parentIds));
      console.log(`[Branch Fix] Branch details:`, message.branches.map(b => ({
        id: b.id,
        parent: b.parentBranchId,
        created: b.createdAt,
        content: b.content.substring(0, 30) + '...'
      })));
      
      // IMPORTANT: Don't auto-fix mixed parents - this needs manual review
      // The issue is that we can't automatically determine which parent is correct
      // without understanding the conversation flow
      console.log(`[Branch Fix] WARNING: Message ${message.id} has mixed parent IDs.`);
      console.log(`[Branch Fix] This requires manual review. Not auto-fixing.`);
      
      // Just report the issue, don't fix it
      continue;
    }
    
    // Check for duplicate content in branches (likely from continue bug)
    const contentMap = new Map<string, string[]>();
    for (const branch of message.branches) {
      const content = branch.content.trim();
      if (content) {
        const branches = contentMap.get(content) || [];
        branches.push(branch.id);
        contentMap.set(content, branches);
      }
    }
    
    // Report duplicates (don't auto-fix as user might want to keep them)
    for (const [content, branchIds] of contentMap) {
      if (branchIds.length > 1) {
        console.log(`[Branch Fix] Warning: Found duplicate content in message ${message.id}`);
        console.log(`[Branch Fix] Duplicate branches:`, branchIds);
        console.log(`[Branch Fix] Content preview:`, content.substring(0, 50) + '...');
      }
    }
  }
  
  console.log(`[Branch Fix] Analysis complete. Found ${fixCount} issues (not auto-fixed).`);
}

/**
 * Ensure the active branch is set to a valid branch
 */
export async function validateActiveBranches(db: Database, conversationId: string): Promise<void> {
  console.log(`[Branch Validation] Checking conversation: ${conversationId}`);
  
  const messages = await db.getConversationMessages(conversationId);
  let fixCount = 0;
  
  for (const message of messages) {
    // Check if activeBranchId points to a valid branch
    const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
    
    if (!activeBranch) {
      console.log(`[Branch Validation] Invalid active branch in message ${message.id}`);
      
      // Set to the most recent branch
      const sortedBranches = [...message.branches].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      if (sortedBranches.length > 0) {
        const newActiveBranch = sortedBranches[0];
        console.log(`[Branch Validation] Setting active branch to ${newActiveBranch.id}`);
        
        await db.setActiveBranch(message.id, newActiveBranch.id);
        fixCount++;
      }
    }
  }
  
  console.log(`[Branch Validation] Fixed ${fixCount} active branches`);
}
