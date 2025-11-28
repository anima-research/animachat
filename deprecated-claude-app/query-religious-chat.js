const fs = require('fs');
const path = require('path');

// Function to read JSONL file
function readJSONL(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

const convId = 'eca82948-11e3-4f43-8abd-52f98c470fb2';
console.log(`Loading Religious Chat (${convId})...\n`);

// Read user events to get participants
const userFile = path.join(__dirname, 'backend/data/users/te/st/test-user-id-12345.jsonl');
const userEvents = readJSONL(userFile);

// Get participants for this conversation
const participants = userEvents
  .filter(e => e.type === 'participant_created' && e.data.participant.conversationId === convId)
  .map(e => e.data.participant);

console.log(`Participants (${participants.length}):`);
participants.forEach(p => {
  const modelInfo = p.model ? `: ${p.model}` : '';
  console.log(`  - ${p.name} (${p.type}${modelInfo})`);
});

// Read the conversation messages
const convPath = path.join(__dirname, 'backend/data/conversations', 
  convId.substring(0, 2), 
  convId.substring(2, 4), 
  `${convId}.jsonl`);

if (!fs.existsSync(convPath)) {
  console.log(`\nConversation file not found at ${convPath}`);
  process.exit(1);
}

const convEvents = readJSONL(convPath);

// Get messages
const messages = convEvents
  .filter(e => e.type === 'message_created')
  .map(e => e.data)
  .sort((a, b) => {
    // Sort by first branch creation time
    const aTime = new Date(a.branches[0]?.createdAt || 0).getTime();
    const bTime = new Date(b.branches[0]?.createdAt || 0).getTime();
    return aTime - bTime;
  });

console.log(`\nMessages (${messages.length} total):\n`);
console.log('='.repeat(80));

// Display messages in chronological order
messages.forEach((msg, idx) => {
  // For each message, show the active branch
  const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId) || msg.branches[0];
  if (activeBranch) {
    const participant = participants.find(p => p.id === activeBranch.participantId);
    const name = participant?.name || activeBranch.role || 'Unknown';
    const model = participant?.model ? ` [${participant.model}]` : '';
    
    console.log(`\n${name}${model}:`);
    console.log('-'.repeat(60));
    
    // Show full content
    console.log(activeBranch.content);
  }
});

console.log('\n' + '='.repeat(80));
console.log('End of conversation');