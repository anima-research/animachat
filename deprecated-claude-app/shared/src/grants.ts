/**
 * A record of a grant usage event.
 */
export interface GrantInfo {
  id: string;
  time: string;
  type: 'mint' | 'burn' | 'send' | 'tally';
  amount: number;
  fromUserId?: string;
  toUserId?: string;
  reason?: string; // human-readable comment about the grant, like 'invite reward', 'purchase', etc.
  causeId?: string; // e.g., transaction ID, invite ID, etc.
  currency?: 'credit'|string; // or a specific model name; credit is implied if absent
}

/**
 * A record of a capability granted to a user.
 */
export interface GrantCapability {
  id: string;
  time: string;
  userId: string;
  action: 'granted'|'revoked';
  capability: 'send'|'mint'|'admin'|'overspend';
  grantedByUserId: string;
  expiresAt?: string;
}

export interface UserGrantSummary {
  totals: Record<string, number>;
  grantInfos: GrantInfo[];
  grantCapabilities: GrantCapability[];
}
