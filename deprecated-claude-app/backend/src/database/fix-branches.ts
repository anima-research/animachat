import { Database } from './index.js';


/**
 * Ensure the active branch is set to a valid branch
 */
export async function validateActiveBranches(db: Database, conversationId: string, conversationOwnerUserId: string): Promise<void> {
  console.log(`[Branch Validation] Checking conversation: ${conversationId}`);
  
  const messages = await db.getConversationMessages(conversationId, conversationOwnerUserId);
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
        
        await db.setActiveBranch(message.id, conversationId, conversationOwnerUserId, newActiveBranch.id);
        fixCount++;
      }
    }
  }
  
  console.log(`[Branch Validation] Fixed ${fixCount} active branches`);
}
