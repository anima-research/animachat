import { Database } from '../database/index.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function importConversations() {
  const db = new Database();
  
  try {
    // Initialize database
    console.log('Initializing database...');
    await db.init();
    console.log('Database initialized');
    
    // Path to the test conversations folder
    const conversationsDir = join(process.cwd(), '../../tesst-convos');
    
    // List of conversation files to import
    const conversationFiles = [
      'conversation-1c2e304d-1f7f-4484-8d24-75b5b951eb60.json',
      'conversation-5787b16b-b45f-45d3-ad37-07384279337d.json',
      'conversation-ccdee88c-0329-4cc0-b1ed-9a273f252331.json'
    ];
    
    for (const filename of conversationFiles) {
      const filePath = join(conversationsDir, filename);
      console.log(`\n=== Importing ${filename} ===`);
      
      try {
        // Read and parse the conversation file
        const fileContent = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);
        
        const { conversation, messages, participants } = data;
        
        // Get or create a test user for imports
        // All conversations will be imported under this user
        const TEST_EMAIL = 'test-import@local.dev';
        let user = await db.getUserByEmail(TEST_EMAIL);
        if (!user) {
          console.log(`Creating test user with email ${TEST_EMAIL}...`);
          user = await db.createUser(
            TEST_EMAIL,
            'test-password-123', // password (won't be used for local testing)
            'Test Import User'
          );
          console.log(`Created user ${user.id}`);
        } else {
          console.log(`Using existing user ${user.id}`);
        }
        
        const importUserId = user.id;
        
        // Check if conversation already exists (by original ID)
        // Note: Since createConversation generates a new UUID, we'll check by title and user
        // For a more robust check, we could store a mapping, but for now we'll just create new ones
        console.log(`Creating conversation "${conversation.title || 'Imported Conversation'}"...`);
        const createdConv = await db.createConversation(
          importUserId,
          conversation.title || 'Imported Conversation',
          conversation.model,
          undefined, // systemPrompt
          conversation.settings,
          conversation.format || 'standard',
          conversation.contextManagement
        );
        
        console.log(`Created conversation with ID ${createdConv.id}`);
        
        // Create participants
        console.log(`Creating ${participants.length} participants...`);
        const participantMap = new Map<string, string>(); // old participant ID -> new participant ID
        
        for (const participantData of participants) {
          // Check if participant already exists by looking for one with same name and type
          const existingParticipants = await db.getConversationParticipants(createdConv.id, importUserId);
          let participant = existingParticipants.find(
            p => p.name === participantData.name && p.type === participantData.type
          );
          
          if (!participant) {
            // For user-type participants, use the importUserId if the original had a userId
            const participantUserId = participantData.type === 'user' && participantData.userId 
              ? importUserId 
              : undefined;
            
            participant = await db.createParticipant(
              createdConv.id,
              importUserId,
              participantData.name,
              participantData.type,
              participantData.model,
              undefined, // systemPrompt
              participantData.settings,
              participantData.contextManagement,
              participantUserId
            );
            console.log(`  Created participant: ${participant.name} (${participant.type})`);
          } else {
            console.log(`  Participant already exists: ${participant.name}`);
          }
          
          // Map old participant ID to new participant ID
          participantMap.set(participantData.id, participant.id);
        }
        
        // Import messages
        console.log(`Importing ${messages.length} messages...`);
        let importedCount = 0;
        
        for (const messageData of messages) {
          try {
            // Update participant IDs in branches to match new participant IDs
            const updatedMessage = {
              ...messageData,
              conversationId: createdConv.id, // Use the new conversation ID
              branches: messageData.branches.map((branch: any) => {
                // Map participantId if it exists
                const newParticipantId = branch.participantId 
                  ? participantMap.get(branch.participantId) || branch.participantId
                  : undefined;
                
                return {
                  ...branch,
                  participantId: newParticipantId
                };
              })
            };
            
            await db.importRawMessage(createdConv.id, importUserId, updatedMessage);
            importedCount++;
          } catch (error) {
            console.error(`  Failed to import message ${messageData.id}:`, error);
          }
        }
        
        console.log(`✓ Successfully imported ${importedCount}/${messages.length} messages`);
        
      } catch (error) {
        console.error(`Failed to import ${filename}:`, error);
      }
    }
    
    console.log('\n=== Import complete ===');
    
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

importConversations();
