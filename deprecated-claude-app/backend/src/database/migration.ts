import { Conversation, Message, Participant } from '@deprecated-claude/shared';
import { EventStore, Event } from './persistence.js';
import { BulkEventStore } from './bulk-event-store.js';

enum EventCategory {
  Main,
  User,
  Conversation,
}

interface EventCategoryInfo {
  category: EventCategory,
  userId?: string,
  conversationId?: string
}

export async function migrateDatabase(
    events: Event[],
    conversations: Map<string, Conversation>,
    participants: Map<string, Participant>,
    messages: Map<string, Message>,
    mainEventStore: EventStore,
    userEventStore: BulkEventStore,
    conversationEventStore: BulkEventStore
) {

    for (const event of events) {
        const eventCategoryInfo = getEventCategoryInfo(event, conversations, participants, messages);
        switch (eventCategoryInfo.category) {
            case EventCategory.Main:
                await mainEventStore.appendEvent(event);
                break;
            case EventCategory.User:
                await userEventStore.appendEvent(eventCategoryInfo.userId!, event);
                break;
            case EventCategory.Conversation:
                await conversationEventStore.appendEvent(eventCategoryInfo.conversationId!, event);
                break;
        }
    }
}

function getEventCategoryInfo(event: Event, conversations: Map<string, Conversation>, participants: Map<string, Participant>, messages: Map<string, Message>): EventCategoryInfo {
  var userId: string = "";
  var conversationId: string = "";
  var category: EventCategory = EventCategory.Main;
  switch (event.type) {
    case 'user_created':
    case 'api_key_created':
    case 'share_created':
    case 'share_deleted':
    case 'share_viewed':
    category = EventCategory.Main;
    break;

    case 'conversation_created':
    if (!conversations.get(event.data.id)) { // cache later deleted ones for reference
      conversations.set(event.data.id, event.data);
    }
    
    case 'conversation_updated':
    case 'conversation_archived':
    conversationId = event.data.id;
    category = EventCategory.User;
    break;
    case 'participant_updated':
    case 'participant_deleted':
    var participant = participants.get(event.data.participantId);
    if (participant) conversationId = participant.conversationId;
    else conversationId = event.data.conversationId; // for deleted, it won't be there anymore, use this as fallback
    category = EventCategory.User;
    break;
    case 'participant_created':
    participant = event.data.participant;
    if (participant) {
      conversationId = participant.conversationId;
      participants.set(participant.id, participant); // add this so we can still see it even if deleted later
    }
    category = EventCategory.User;
    break;
    case 'metrics_added':
    conversationId = event.data.conversationId;
    category = EventCategory.User;
    break;
    case 'message_created':
    var message = messages.get(event.data.id);
    if (!message) {
      messages.set(event.data.id, event.data); // store it in case it was deleted
      conversationId = event.data.conversationId; // needed in case this message later deleted
      if (!conversationId) {
        console.error(`Error: event ${event.type} of type User had message id ${event.data.messageId} which does not exist, skipping.`);
        return { category: EventCategory.Main }; // broken, just default to main
      }
    }
    else {
      conversationId = message.conversationId;
    }
    category = EventCategory.Conversation;
    break;
    case 'message_branch_added':
    case 'active_branch_changed':
    case 'message_content_updated':
    case 'message_deleted':
    case 'message_imported_raw':
    case 'message_branch_deleted':
    message = messages.get(event.data.messageId);
    if (!message) { // this can happen for deleted messages since they won't exist anymore
      conversationId = event.data.conversationId; // fallback, often this exists and we are ok
      if (!conversationId) {
        console.error(`Error: event ${event.type} of type User had message id ${event.data.messageId} which does not exist, skipping.`);
        return { category: EventCategory.Main }; // broken, just default to main
      }
    }
    else {
      conversationId = message.conversationId;
    }
    category = EventCategory.Conversation;
    break;
    default:
    console.error(`Error: Unknown event type ${event.type}, leaving this event in Main`);
    category = EventCategory.Main;
  }

  if (category == EventCategory.User) {
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      console.error(`Error: event ${event.type} of type User had conversation id ${conversationId} which does not exist, skipping.`);
      return { category: EventCategory.Main }; // broken, just default to main
    }
    userId = conversation.userId;
  }

  return {
    category,
    userId,
    conversationId
  };
}