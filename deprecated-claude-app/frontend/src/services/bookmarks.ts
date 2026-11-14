import type { Bookmark } from '@deprecated-claude/shared';
import { api } from '@/services/api';
import { createSharedRequest } from '@/utils/sharedRequest';

// Every MessageComponent, the tree and the view need the same list; without
// sharing, a reload of an N-message conversation sent N identical GETs.
// Cleared entirely when a conversation is (re)loaded and on logout (so only the
// open conversation's list is held), and per conversation after a bookmark is
// saved or deleted from this client.
const conversationBookmarks = createSharedRequest<Bookmark[]>(async (conversationId) => {
  const response = await api.get(`/bookmarks/conversation/${conversationId}`);
  return response.data;
});

export const getConversationBookmarks = conversationBookmarks.get;
export const invalidateConversationBookmarks = conversationBookmarks.invalidate;
