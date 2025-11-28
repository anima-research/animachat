# Invite System - Spec v2

## What Invites Are

An invite is a **claimable credit grant**. Someone with minting power creates a code worth X credits. Anyone who redeems that code gets those credits added to their account.

Registration stays open. Invites are gifts, not gates.

---

## How It Works

### Creating an invite

Tavy has `mint` capability. She wants to sponsor Maya's usage.

She creates an invite:
- Code: `maya-november` (or auto-generated)
- Amount: 500
- Currency: `credit` (or model-specific)
- Expires: 30 days (optional)

This is stored as a "promised mint" - credits waiting to be claimed.

### Claiming an invite

Maya can claim in two ways:

**During registration:** She enters the code in registration form (or arrives via `?invite=maya-november`). After her account is created, the credits are minted to her.

**After registration:** She already has an account. She goes to Settings → Grants → "Redeem Invite Code", enters the code, gets the credits.

Either way, the invite is marked used, and a `mint` event is recorded with `causeId: "maya-november"` linking back to the invite.

### What the sponsor sees

Tavy can list her invites - which are claimed, which are pending, which expired unused.

---

## Data Model

```typescript
interface Invite {
  code: string;           // Primary key
  createdBy: string;      // userId who created it
  createdAt: string;      // ISO timestamp
  
  // The promised grant
  amount: number;
  currency: string;       // "credit" or model-specific
  
  // Lifecycle
  expiresAt?: string;     // Optional expiration
  claimedBy?: string;     // userId who redeemed
  claimedAt?: string;     // When redeemed
}
```

**Events:**
- `invite_created` → stores the invite
- `invite_claimed` → marks it used, triggers the mint

---

## Backend Changes

### Database (`database/index.ts`)

New storage:
```typescript
private invites: Map<string, Invite> = new Map();
```

New methods:
```typescript
createInvite(code: string, createdBy: string, amount: number, currency: string, expiresAt?: string): Promise<Invite>
getInvite(code: string): Promise<Invite | null>
claimInvite(code: string, claimedBy: string): Promise<void>  // validates + mints
listInvitesByCreator(userId: string): Promise<Invite[]>
validateInvite(code: string): { valid: boolean; error?: string; invite?: Invite }
```

The `claimInvite` method does two things atomically:
1. Marks the invite as claimed
2. Calls `recordGrantInfo({ type: 'mint', amount, toUserId, causeId: code, ... })`

### Routes (`routes/auth.ts` or new `routes/invites.ts`)

```typescript
// Create invite (requires mint capability)
POST /invites
Body: { code?: string, amount: number, currency?: string, expiresInDays?: number }
Returns: { code, amount, currency, expiresAt }

// List your invites
GET /invites
Returns: Invite[]

// Claim an invite (authenticated)
POST /invites/claim
Body: { code: string }
Returns: { success: true, amount, currency }

// Check invite validity (public, for UI validation)
GET /invites/:code/check
Returns: { valid: boolean, amount?, currency?, error? }
```

### Registration integration

In `/register`, after user is created:
```typescript
if (data.inviteCode) {
  const validation = db.validateInvite(data.inviteCode);
  if (validation.valid) {
    await db.claimInvite(data.inviteCode, user.id);
    // Credits are now in their account
  }
  // If invalid, registration still succeeds - they just don't get the credits
  // (Or we could warn them - design choice)
}
```

---

## Frontend Changes

### Registration form (`LoginView.vue`)

Add optional invite code field:
```vue
<input 
  v-if="isRegistering"
  v-model="inviteCode" 
  type="text" 
  placeholder="Invite code (optional)"
/>
```

Parse from URL: `?invite=maya-november` pre-fills the field.

Show validation feedback (optional nice-to-have):
- On blur, check `/invites/:code/check`
- Show "✓ 500 credits" or "✗ Invalid code"

### Settings → Grants → Redeem

Add "Redeem Code" section to `GrantsTab.vue` (visible to all users, not just those with mint):

```vue
<section class="mb-4">
  <h4 class="text-h6 mb-3">Redeem Invite</h4>
  <div class="d-flex" style="gap: 8px;">
    <v-text-field v-model="redeemCode" placeholder="Enter invite code" density="compact" />
    <v-btn color="primary" @click="redeem">Redeem</v-btn>
  </div>
</section>
```

Calls `POST /invites/claim`, shows success message with amount received, refreshes grants display.

### Invite creation (in GrantActions.vue)

The existing `GrantActions.vue` has "Mint" and "Send" buttons. We add a third: **"Invite"**.

Same pattern as Mint/Send:
- Click "Invite" → opens dialog
- Enter: amount, currency, optional custom code, optional expiration
- Submit → creates invite, shows the code + copyable link
- No email field (unlike Mint which requires existing user)

```vue
<!-- In GrantActions.vue button row -->
<v-btn v-if="props.canMint" color="primary" @click="open('mint')">Mint</v-btn>
<v-btn v-if="props.canSend" color="primary" variant="outlined" @click="open('send')">Send</v-btn>
<v-btn v-if="props.canMint" color="primary" variant="outlined" @click="open('invite')">Invite</v-btn>
```

The invite dialog is simpler than mint - no email lookup needed:
- Amount (required)
- Currency (dropdown, same as mint)
- Custom code (optional, auto-generates if empty)
- Expires in days (optional, default 30)

On success, show the generated code and a "Copy Link" button:
```
✓ Invite created: maya-november
https://arc.anima.ai/login?invite=maya-november [Copy]
```

**Optional enhancement:** Below the actions, show a small list of your pending invites with their status. But this can wait for v2 - the core flow works without it.

---

## Flows

### Flow A: Sponsor creates invite, sends link

```
1. Tavy opens Settings → Grants
2. Clicks "Invite" button (next to Mint/Send)
3. Enters 500 credits, optionally custom code "maya-november"
4. Submits → sees generated link, clicks "Copy"
5. Sends link to Maya
6. Maya clicks link, lands on registration with code pre-filled
7. Maya registers, gets 500 credits automatically
```

### Flow B: Existing user redeems code

```
1. Tavy tells Maya "use code maya-november"
2. Maya logs into her existing account
3. Goes to Settings → Grants → Redeem
4. Enters "maya-november"
5. Gets 500 credits added to balance
```

### Flow C: Registration without invite

```
1. Someone finds Arc, registers without a code
2. They get whatever initialGrants config provides (could be 0)
3. Later, they get a code from someone
4. They redeem it in Settings → Grants
```

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Invalid code | Error: "Invalid invite code" |
| Already claimed | Error: "This invite has already been used" |
| Expired | Error: "This invite has expired" |
| Claim your own invite | Allowed? (Probably yes - it's your credits) |
| Claim during registration fails | User still created, just no bonus credits |
| Creator has mint revoked after creating invite | Invite still valid (was authorized at creation) |

---

## What We're NOT Building (v1)

- Multi-use codes (one code for 50 people) - easy to add later
- Invite limits per user - add when needed
- Revoking invites - let them expire instead
- Notification when your invite is claimed - nice-to-have
- Referral tracking / invite chains - future feature

---

## Files Changed

```
backend/src/database/index.ts           +80 lines (invite storage, methods)
backend/src/routes/invites.ts           +100 lines (new file, endpoints)
backend/src/routes/auth.ts              +10 lines (claim on registration)
backend/src/index.ts                    +2 lines (mount invites router)
frontend/src/views/LoginView.vue        +20 lines (optional invite field)
frontend/src/components/GrantActions.vue +60 lines (add Invite action + dialog)
frontend/src/components/GrantsTab.vue   +15 lines (add Redeem section)
shared/src/types.ts                     +15 lines (Invite type)
```

**Total: ~300 lines**

---

## Time Estimate

- Backend (storage, endpoints): 3 hours
- Frontend (registration field): 1 hour
- Frontend (GrantActions invite button + dialog): 1.5 hours
- Frontend (GrantsTab redeem section): 0.5 hours
- Testing: 1 hour

**Total: ~7 hours**

