# Invite System Analysis for Arc Chat

## Current State

**Registration is open** - Anyone with email/password/name can register at `/auth/register`

**Architecture:**
- Event-sourced database (JSONL files)
- Users: `{ id, email, name, createdAt, apiKeys }`
- Initial grants given on registration from config
- Capability system exists (`send`, `mint`, `admin`, `overspend`) but users don't have explicit "roles" field
- No admin UI - capabilities managed manually

**What we need:** A way to restrict who can register

---

## Option A: Simple Invite Codes

### How it works
1. Admin generates invite codes (CLI script or simple endpoint)
2. Codes stored in DB: `{ code, createdBy, createdAt, usedBy?, usedAt?, expiresAt? }`
3. Registration requires valid unused code
4. Code marked as used after successful registration

### Implementation
- **Backend:** ~50-80 lines
  - Add `invites` Map to database
  - Add invite events (`invite_created`, `invite_used`)
  - Modify `/register` to require `inviteCode` param
  - Add `POST /invites` (admin-only) to create codes
- **Frontend:** ~20 lines
  - Add invite code field to registration form
- **Database:** New event types, no migration needed

### Pros
- ✅ Simplest to implement (~2-3 hours)
- ✅ Works with event-sourcing model
- ✅ Admins control access completely
- ✅ Can be anonymous (code doesn't need to know who it's for)

### Cons
- ❌ Manual code generation (need to email/DM codes to people)
- ❌ No tracking of who-invited-whom
- ❌ No self-service invite generation

### Effort: ⭐☆☆☆☆ (Easiest)

---

## Option B: Email Whitelist

### How it works
1. Config file contains `allowedEmails: ["friend@gmail.com", "*@anima.ai"]`
2. Registration checks email against whitelist
3. Supports wildcards for domains

### Implementation
- **Backend:** ~20 lines
  - Add config field
  - Check email in `/register` before creating user
- **Frontend:** ~0 lines (maybe error message)
- **Config:** Add `allowedEmails` array

### Pros
- ✅ Absolute minimum implementation (~30 mins)
- ✅ No database changes
- ✅ Domain wildcards useful for team access

### Cons
- ❌ Need to redeploy/restart to update whitelist (unless hot-reload config)
- ❌ Not scalable for "invite your friend" flow
- ❌ Requires collecting emails manually
- ❌ No tracking, no expiration

### Effort: ⭐☆☆☆☆ (Easiest, but least flexible)

---

## Option C: User-Generated Invites

### How it works
1. Users with `invite` capability can generate invite codes
2. Optionally limit invites per user (e.g., 5 invites)
3. Track referral chain: who invited whom
4. Optional: inviter gets bonus credits when invitee registers

### Implementation
- **Backend:** ~150-200 lines
  - Same as Option A, plus:
  - `invite` capability
  - Invite limits per user
  - Referral tracking (add `invitedBy` to User)
  - Optional: bonus credits on successful invite
- **Frontend:** ~100 lines
  - "Generate Invite" button in settings
  - Show remaining invites
  - Copy invite link
- **Shared types:** Add `invitedBy` to User schema

### Pros
- ✅ Enables organic community growth
- ✅ People can invite friends without admin involvement
- ✅ Social accountability (you know who invited problematic users)
- ✅ Can tie into grant system (bonus credits)

### Cons
- ❌ More complex (~1 day work)
- ❌ Need UI for generating/viewing invites
- ❌ Need to decide invite limits and policies
- ❌ Opens potential for abuse (need to think about revoking)

### Effort: ⭐⭐⭐☆☆ (Medium)

---

## Option D: Request + Approval Flow

### How it works
1. Registration form becomes "Request Access" form
2. Requests stored in DB pending approval
3. Admin reviews requests, approves/rejects
4. Approved users get email with registration link (or auto-registered)

### Implementation
- **Backend:** ~200-300 lines
  - New `accessRequests` table
  - Request submission endpoint
  - Admin approval/rejection endpoints
  - Email sending (new dependency)
- **Frontend:** ~200 lines
  - Request access form
  - Admin panel for reviewing requests
- **New dependency:** Email service (SendGrid, SES, etc.)

### Pros
- ✅ Maximum control over who joins
- ✅ Can ask screening questions ("How did you hear about us?")
- ✅ Admin sees everyone before they join
- ✅ Good for waitlist vibes

### Cons
- ❌ Most complex (~2-3 days work)
- ❌ Requires email infrastructure
- ❌ Creates friction/delay for users
- ❌ Admin overhead to review requests
- ❌ Need admin UI

### Effort: ⭐⭐⭐⭐☆ (Hardest)

---

## Option E: Hybrid - Invite Codes with Optional Limits

### How it works
- Combines A + C
- Start with admin-only invite generation (Option A)
- Later add user invite generation (Option C)
- Built extensible from the start

### Implementation (Phase 1 = Option A)
- Same as Option A initially
- Schema designed to support Phase 2:
  ```typescript
  interface Invite {
    code: string;
    createdBy: string;  // userId
    createdAt: Date;
    expiresAt?: Date;
    usedBy?: string;    // userId
    usedAt?: Date;
    maxUses?: number;   // for multi-use codes
    currentUses: number;
  }
  ```

### Pros
- ✅ Get something working fast (Option A)
- ✅ Path to community growth later (Option C)
- ✅ No throwaway work

### Effort: ⭐⭐☆☆☆ (Start easy, grow later)

---

## My Recommendation

**Start with Option E (Hybrid), Phase 1 only.**

Why:
1. **Fastest to ship** - You need invites now, not in a week
2. **No throwaway work** - Schema supports future expansion
3. **Manual is fine initially** - You probably know everyone who's getting an invite
4. **User invites can wait** - Add when community is bigger

### Minimum Viable Implementation

**Backend changes:**
1. Add `invites` Map to `Database` class
2. Add `invite_created` and `invite_redeemed` events
3. Add `POST /auth/invites` (admin-only, generates code)
4. Add `GET /auth/invites` (admin-only, list invites)
5. Modify `POST /auth/register` to require `inviteCode`

**Frontend changes:**
1. Add `inviteCode` field to registration form (maybe from URL param `?invite=ABC123`)
2. Show error if code invalid/used

**Not needed initially:**
- User invite generation
- Invite limits
- Referral tracking
- Admin UI (use CLI or direct API calls)

**Time estimate:** 3-4 hours to have working invites

---

## Questions to Decide

1. **Single-use or multi-use codes?**
   - Single-use: simpler, more traceable
   - Multi-use: good for events ("DISCORD2024" code for 50 people)
   
2. **Expiration?**
   - Probably yes, default 30 days?
   
3. **How to generate?**
   - CLI script initially
   - Admin endpoint later
   - Random string or human-readable ("WELCOME-TAVY-2024")?

4. **What happens if someone tries to register without code?**
   - Show "invite only" message
   - Maybe show request access form (defer to later)

5. **Existing users?**
   - No change, they're already in

---

## Implementation Order (if you want to proceed)

1. [ ] Backend: Add invite schema and events
2. [ ] Backend: Create/list invites endpoints (admin)  
3. [ ] Backend: Validate invite on registration
4. [ ] Frontend: Add invite code to registration form
5. [ ] Frontend: Parse `?invite=` from URL
6. [ ] Test: Generate code, register with it
7. [ ] Document: How to generate invites

Want me to start implementing?

