/**
 * A record of a grant usage event.
 */
export interface GrantTokenUsage {
  price: number;
  tokens: number;
  credits: number;
}

export interface GrantUsageDetails {
  input?: GrantTokenUsage;
  output?: GrantTokenUsage;
  cached_input?: GrantTokenUsage;
  reasoning_output?: GrantTokenUsage;
  [tokenType: string]: GrantTokenUsage | undefined;
}

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
  details?: GrantUsageDetails;
}

/**
 * A record of a capability granted to a user.
 */
export interface GrantCapability {
  id: string;
  time: string;
  userId: string;
  action: 'granted'|'revoked';
  capability: 'send'|'mint'|'admin'|'overspend'|'researcher';
  grantedByUserId: string;
  expiresAt?: string;
}

export interface UserGrantSummary {
  totals: Record<string, number>;
  grantInfos: GrantInfo[];
  grantCapabilities: GrantCapability[];
  availableCurrencies?: string[];
}
