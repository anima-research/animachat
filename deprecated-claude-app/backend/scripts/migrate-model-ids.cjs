#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Create a mapping from old providerModelId to new id
const modelsPath = path.join(__dirname, '..', 'config', 'models.json');
const models = JSON.parse(fs.readFileSync(modelsPath, 'utf8')).models;

const modelIdMapping = {};
models.forEach(model => {
  modelIdMapping[model.providerModelId] = model.id;
});

// Add any additional mappings for models that might not be in the config yet
// but exist in old conversations
const additionalMappings = {
  // These are handled by the auto-mapping above, but listed for clarity
  'claude-opus-4-1-20250805': 'claude-opus-4.1',
  'claude-opus-4-20250514': 'claude-opus-4',
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  'claude-3-7-sonnet-20250219': 'claude-3.7-sonnet',
  'claude-3-5-haiku-20241022': 'claude-3.5-haiku'
};

// Merge additional mappings
Object.assign(modelIdMapping, additionalMappings);

console.log('Model ID mapping:');
console.log(JSON.stringify(modelIdMapping, null, 2));

// Load events from the event store
const eventsPath = path.join(__dirname, '..', 'data', 'events.jsonl');
if (!fs.existsSync(eventsPath)) {
  console.error('No events.jsonl file found. Nothing to migrate.');
  process.exit(0);
}

const events = fs.readFileSync(eventsPath, 'utf8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => JSON.parse(line));

console.log(`\nLoaded ${events.length} events from event store`);

// Track what we'll migrate
let conversationsMigrated = 0;
let participantsMigrated = 0;
let messagesMigrated = 0;

// Process events and migrate model IDs
const migratedEvents = events.map(event => {
  // Deep clone the event to avoid mutations
  const newEvent = JSON.parse(JSON.stringify(event));
  
  switch (event.type) {
    case 'conversation_created':
      if (newEvent.data.model && modelIdMapping[newEvent.data.model]) {
        console.log(`Migrating conversation ${newEvent.data.id}: ${newEvent.data.model} -> ${modelIdMapping[newEvent.data.model]}`);
        newEvent.data.model = modelIdMapping[newEvent.data.model];
        conversationsMigrated++;
      }
      break;
      
    case 'conversation_updated':
      // conversation_updated can have model in updates field
      if (newEvent.data.updates && newEvent.data.updates.model && modelIdMapping[newEvent.data.updates.model]) {
        console.log(`Migrating conversation update ${newEvent.data.id}: ${newEvent.data.updates.model} -> ${modelIdMapping[newEvent.data.updates.model]}`);
        newEvent.data.updates.model = modelIdMapping[newEvent.data.updates.model];
        conversationsMigrated++;
      }
      break;
      
    case 'participant_created':
      if (newEvent.data.participant && newEvent.data.participant.model && modelIdMapping[newEvent.data.participant.model]) {
        console.log(`Migrating participant ${newEvent.data.participant.id}: ${newEvent.data.participant.model} -> ${modelIdMapping[newEvent.data.participant.model]}`);
        newEvent.data.participant.model = modelIdMapping[newEvent.data.participant.model];
        participantsMigrated++;
      }
      break;
      
    case 'participant_updated':
      // participant_updated can have model in updates field
      if (newEvent.data.updates && newEvent.data.updates.model && modelIdMapping[newEvent.data.updates.model]) {
        console.log(`Migrating participant update ${newEvent.data.participantId}: ${newEvent.data.updates.model} -> ${modelIdMapping[newEvent.data.updates.model]}`);
        newEvent.data.updates.model = modelIdMapping[newEvent.data.updates.model];
        participantsMigrated++;
      }
      break;
      
    case 'message_created':
      // message_created has branches array with model in each branch
      if (newEvent.data.branches && Array.isArray(newEvent.data.branches)) {
        newEvent.data.branches.forEach(branch => {
          if (branch.model && modelIdMapping[branch.model]) {
            console.log(`Migrating message branch model: ${branch.model} -> ${modelIdMapping[branch.model]}`);
            branch.model = modelIdMapping[branch.model];
            messagesMigrated++;
          }
        });
      }
      break;
      
    case 'message_branch_added':
      // message_branch_added has branch object with model
      if (newEvent.data.branch && newEvent.data.branch.model && modelIdMapping[newEvent.data.branch.model]) {
        console.log(`Migrating added branch model: ${newEvent.data.branch.model} -> ${modelIdMapping[newEvent.data.branch.model]}`);
        newEvent.data.branch.model = modelIdMapping[newEvent.data.branch.model];
        messagesMigrated++;
      }
      break;
      
    case 'message_content_updated':
      // message_content_updated might have model in data
      if (newEvent.data.model && modelIdMapping[newEvent.data.model]) {
        console.log(`Migrating message update model: ${newEvent.data.model} -> ${modelIdMapping[newEvent.data.model]}`);
        newEvent.data.model = modelIdMapping[newEvent.data.model];
        messagesMigrated++;
      }
      break;
  }
  
  return newEvent;
});

// Backup the original events file
const backupPath = eventsPath + '.backup-' + new Date().toISOString().replace(/:/g, '-');
fs.copyFileSync(eventsPath, backupPath);
console.log(`\nCreated backup at: ${backupPath}`);

// Write the migrated events
const output = migratedEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
fs.writeFileSync(eventsPath, output);

console.log('\nMigration complete!');
console.log(`- Conversations migrated: ${conversationsMigrated}`);
console.log(`- Participants migrated: ${participantsMigrated}`);
console.log(`- Messages migrated: ${messagesMigrated}`);
console.log('\nRestart the application to load the migrated data.');
