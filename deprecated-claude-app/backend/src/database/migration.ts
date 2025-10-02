import { User, Conversation, Message, Participant, ApiKey } from '@deprecated-claude/shared';
import { EventStore, Event } from './persistence.js';

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

function getEventType(event: Event, conversations: Map<string, Conversation>, messages: Map<string, Message>, ): EventCategoryInfo {
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
    case 'conversation_updated':
    case 'conversation_archived':
    conversationId = event.data.id;
    category = EventCategory.User;
    break;
    case 'participant_created':
    case 'participant_updated':
    case 'participant_deleted':
    case 'metrics_added':
    conversationId = event.data.conversationId;
    category = EventCategory.User;
    break;
    case 'message_created':
    case 'message_branch_added':
    case 'active_branch_changed':
    case 'message_content_updated':
    case 'message_deleted':
    case 'message_imported_raw':
    case 'message_branch_deleted':
    const message = messages.get(event.data.messageId);
    if (!message) {
      console.error(`Error: event ${event.type} of type User had message id ${event.data.messageId} which does not exist, skipping.`);
      return { category: EventCategory.Main }; // broken, just default to main
    }
    conversationId = message.conversationId;
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