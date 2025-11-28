# Invite System - Implementation Spec

## Goal
Restrict registration to invite-only. Admin generates codes, users redeem on signup.

---

## Data Model

```typescript
interface Invite {
  code: string;           // Primary key, e.g. "ABC123" or "welcome-tavy"
  createdBy: string;      // userId of admin who created
  createdAt: string;      // ISO timestamp
  expiresAt?: string;     // Optional expiration
  usedBy?: string;        // userId who redeemed
  usedAt?: string;        // When redeemed
}
```

**Events:**
- `invite_created`: `{ invite: Invite }`
- `invite_redeemed`: `{ code: string, userId: string, usedAt: string }`

**Storage:** New `Map<string, Invite>` in Database class, replayed from events.

---

## Backend Changes

### 1. Database (`database/index.ts`)

```typescript
private invites: Map<string, Invite> = new Map();

// In replayEvent():
case 'invite_created':
  this.invites.set(event.data.invite.code, event.data.invite);
  break;
case 'invite_redeemed':
  const inv = this.invites.get(event.data.code);
  if (inv) {
    inv.usedBy = event.data.userId;
    inv.usedAt = event.data.usedAt;
  }
  break;

// New methods:
async createInvite(code: string, createdBy: string, expiresAt?: string): Promise<Invite>
async getInvite(code: string): Promise<Invite | null>
async redeemInvite(code: string, userId: string): Promise<void>
async listInvites(): Promise<Invite[]>
validateInvite(code: string): { valid: boolean; error?: string }
```

### 2. Auth Routes (`routes/auth.ts`)

**Modify `/register`:**
```typescript
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string(),
  inviteCode: z.string().min(1)  // ADD THIS
});

// In handler, before createUser:
const validation = db.validateInvite(data.inviteCode);
if (!validation.valid) {
  return res.status(400).json({ error: validation.error });
}

// After createUser succeeds:
await db.redeemInvite(data.inviteCode, user.id);
```

**New endpoints:**

```typescript
// Create invite (admin only)
POST /auth/invites
Body: { code?: string, expiresInDays?: number }
Response: { code: string, expiresAt?: string }
Auth: Requires 'admin' capability

// List invites (admin only)  
GET /auth/invites
Response: Invite[]
Auth: Requires 'admin' capability
```

### 3. Validation Logic

```typescript
validateInvite(code: string): { valid: boolean; error?: string } {
  const invite = this.invites.get(code);
  
  if (!invite) 
    return { valid: false, error: 'Invalid invite code' };
  
  if (invite.usedBy) 
    return { valid: false, error: 'Invite already used' };
  
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date())
    return { valid: false, error: 'Invite expired' };
  
  return { valid: true };
}
```

---

## Frontend Changes

### 1. Registration Form (`views/LoginView.vue`)

Add invite code field (appears only in register mode):

```vue
<input 
  v-if="isRegistering"
  v-model="inviteCode" 
  type="text" 
  placeholder="Invite code"
  required
/>
```

Pass to register call:
```typescript
await store.register(email.value, password.value, name.value, inviteCode.value);
```

### 2. URL Parameter Support

Parse `?invite=ABC123` from URL and pre-fill:

```typescript
const route = useRoute();
const inviteCode = ref(route.query.invite as string || '');
```

This lets us share links like `https://arc.anima.ai/login?invite=ABC123`

### 3. Store (`store/index.ts`)

```typescript
async register(email: string, password: string, name: string, inviteCode: string) {
  const response = await api.post('/auth/register', { email, password, name, inviteCode });
  // ... rest unchanged
}
```

---

## Admin Workflow

**Generate invite (CLI or curl):**
```bash
curl -X POST https://arc.anima.ai/api/auth/invites \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "welcome-friend", "expiresInDays": 30}'
```

**List invites:**
```bash
curl https://arc.anima.ai/api/auth/invites \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Share with user:**
- Option A: Send code directly, they enter in form
- Option B: Send link `https://arc.anima.ai/login?invite=welcome-friend`

---

## Edge Cases

| Case | Behavior |
|------|----------|
| No invite code provided | 400: "Invite code required" |
| Invalid code | 400: "Invalid invite code" |
| Already used | 400: "Invite already used" |
| Expired | 400: "Invite expired" |
| Registration fails after validation | Invite NOT marked used (atomic) |
| Code collision on create | 400: "Code already exists" |

---

## Not Included (Future)

- Admin UI for invites (use CLI/curl for now)
- User-generated invites
- Multi-use codes
- Referral tracking
- Delete/revoke invites

---

## Files Changed

```
backend/src/database/index.ts    # +60 lines (invite storage & methods)
backend/src/routes/auth.ts       # +40 lines (endpoints, validation)
frontend/src/views/LoginView.vue # +15 lines (invite field)
frontend/src/store/index.ts      # +2 lines (pass inviteCode)
shared/src/types.ts              # +10 lines (Invite type, optional)
```

**Total: ~130 lines of code**

---

## Time Estimate

- Backend: 2 hours
- Frontend: 1 hour  
- Testing: 30 min
- **Total: ~3.5 hours**

