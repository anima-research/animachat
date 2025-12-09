/**
 * Conversation sharing types and interfaces.
 */

export type SharePermission = 'viewer' | 'collaborator' | 'editor';

/**
 * A record of a conversation share.
 */
export interface ConversationShare {
  id: string;
  conversationId: string;
  sharedWithUserId: string;
  sharedWithEmail: string; // For display purposes
  sharedByUserId: string;
  permission: SharePermission;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Event logged when a conversation is shared.
 */
export interface ShareCreatedEvent {
  type: 'share_created';
  id: string;
  time: string;
  conversationId: string;
  sharedWithUserId: string;
  sharedWithEmail: string;
  sharedByUserId: string;
  permission: SharePermission;
}

/**
 * Event logged when share permission is updated.
 */
export interface ShareUpdatedEvent {
  type: 'share_updated';
  id: string;
  time: string;
  shareId: string;
  conversationId: string;
  permission: SharePermission;
  updatedByUserId: string;
}

/**
 * Event logged when a share is revoked.
 */
export interface ShareRevokedEvent {
  type: 'share_revoked';
  id: string;
  time: string;
  shareId: string;
  conversationId: string;
  revokedByUserId: string;
}

export type ShareEvent = ShareCreatedEvent | ShareUpdatedEvent | ShareRevokedEvent;

/**
 * Check if a permission level allows chatting.
 */
export function canChat(permission: SharePermission): boolean {
  return permission === 'collaborator' || permission === 'editor';
}

/**
 * Check if a permission level allows deleting messages.
 */
export function canDelete(permission: SharePermission): boolean {
  return permission === 'editor';
}

/**
 * Check if a permission level allows viewing.
 */
export function canView(permission: SharePermission): boolean {
  return true; // All levels can view
}

/**
 * Permission level hierarchy for comparison.
 */
const PERMISSION_LEVELS: Record<SharePermission, number> = {
  viewer: 1,
  collaborator: 2,
  editor: 3
};

/**
 * Check if permission A is at least as permissive as permission B.
 */
export function hasAtLeastPermission(
  userPermission: SharePermission,
  requiredPermission: SharePermission
): boolean {
  return PERMISSION_LEVELS[userPermission] >= PERMISSION_LEVELS[requiredPermission];
}

