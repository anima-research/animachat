# Arc Chat: Monorepo-Wide Test Coverage Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Before claiming any task complete, use superpowers:verification-before-completion.

**Goal:** Achieve trustworthy automated test coverage across the entire monorepo — shared, backend, and frontend.

**Architecture:** Vitest across all three workspaces. Tests are organized into tiers by testability: pure functions first (no mocking), then services (mock one layer), then orchestrators (extract-then-test). Every module gets coverage — nothing is skipped.

**Tech Stack:** Vitest, @vitest/coverage-v8, @vue/test-utils, happy-dom

---

## Agent Workflow

When spawning teammates to execute this plan:

1. **Set up worktrees BEFORE spawning agents.** Commit all prerequisite work, create branches, create worktrees, run `npm install`, verify setup — then spawn.
2. **Pre-assign tasks** with `TaskUpdate(owner: "agent-name")` before the agent exists, so they can't grab the wrong one.
3. **Bake the worktree path into the spawn prompt.** Messages sent after spawn may not arrive until the agent's current turn ends. The spawn prompt is your only reliable instruction.
4. **Remind agents of skills:** Include `Before claiming any task complete, use /superpowers:verification-before-completion` in every spawn prompt.

---

## Test Coverage Targets

### Coverage requirements by area

| Area | Stmt | Branch | Tier |
|------|------|--------|------|
| **shared/** (Zod schemas) | 95% | 90% | Done |
| **backend/middleware/auth** | 90% | 85% | Done |
| **backend/websocket/prompt-utils** | 90% | 85% | Done |
| **backend/utils/** (encryption, error-messages) | 90% | 85% | 1 |
| **backend/services/importParser** | 90% | 85% | 1 |
| **backend/services/context-strategies** | 90% | 85% | 1 |
| **backend/services/pricing-cache** | 90% | 85% | 1 |
| **backend/services/cache-strategies** | 85% | 80% | 1 |
| **backend/websocket/room-manager** | 90% | 85% | 1 |
| **backend/config/** (loader, model-loader, site-config) | 85% | 80% | 1 |
| **frontend/utils/** (authenticity, modelColors, latex, avatars) | 90% | 85% | 1 |
| **backend/services/content-filter** | 85% | 80% | 2 |
| **backend/services/api-key-manager** | 85% | 80% | 2 |
| **backend/services/anthropic** (formatting only) | 80% | 75% | 2 |
| **backend/services/bedrock** (formatting only) | 80% | 75% | 2 |
| **backend/services/openrouter** (formatting + pricing) | 80% | 75% | 2 |
| **backend/services/gemini** (formatting only) | 80% | 75% | 2 |
| **backend/services/openai-compatible** (formatting only) | 80% | 75% | 2 |
| **backend/services/email** (template rendering) | 80% | 75% | 2 |
| **backend/database/persistence** | 85% | 80% | 2 |
| **backend/database/blob-store** | 85% | 80% | 2 |
| **backend/database/collaboration** | 85% | 80% | 2 |
| **backend/database/shares** | 85% | 80% | 2 |
| **backend/database/persona** | 80% | 75% | 2 |
| **backend/database/conversation-ui-state** | 80% | 75% | 2 |
| **frontend/services/websocket** | 75% | 70% | 2 |
| **frontend/composables/useSiteConfig** | 80% | 75% | 2 |
| **backend/database/index** (extracted managers) | 80% | 75% | 3 |
| **backend/services/inference** (extracted logic) | 75% | 70% | 3 |
| **backend/websocket/handler** (extracted logic) | 75% | 70% | 3 |
| **backend/routes/** (integration tests) | 70% | 65% | 3 |
| **frontend/store/** (extracted selectors) | 75% | 70% | 3 |

### What counts as a real test

Every test must satisfy **all three** of these criteria:

1. **It can fail.** If you delete or break the code under test, at least one assertion in the test must fail. If a test passes regardless of whether the implementation is correct, it is not a test.

2. **It tests a behavior, not an implementation detail.** Test what a function *does* (given input X, returns Y / throws Z / mutates state to W), not *how* it does it (called helper A, used Map internally, iterated 3 times). A correct refactoring of the implementation should not break the test.

3. **The expected value is independently specified.** The test must define its expected output based on the *specification* of the behavior — not by copying the implementation's logic. If you find yourself re-deriving the expected value using the same algorithm as the code under test, you're writing a tautology, not a test.

### Banned test patterns

Do not write tests matching any of these patterns. If you catch yourself writing one, delete it and write a proper test instead.

**Tautological tests** — the assertion is guaranteed to pass by construction:
```typescript
// BAD: testing that a value equals itself
const result = formatMessage(input);
expect(result).toEqual(result);

// BAD: re-deriving the expected output using the same logic
const expected = prefix + name + suffix; // same concat the code does
expect(result).toBe(expected);
```

**Mock-everything tests** — nothing real executes, you're testing your mocks:
```typescript
// BAD: every dependency is mocked, test only verifies wiring
vi.mock('../database');
vi.mock('../services/inference');
vi.mock('../config/loader');
// ...then asserting that mocked function was called with mocked data
expect(mockDb.createUser).toHaveBeenCalledWith(mockData);
```
When mocking, keep at least one real layer. Mocking the database is fine when testing a service. Mocking both the service *and* its dependencies means you're testing nothing.

**Existence tests** — checking that something exists rather than that it works:
```typescript
// BAD: proves nothing about correctness
expect(typeof createUser).toBe('function');
expect(UserManager).toBeDefined();
```

**Always-true assertions** — assertion holds regardless of code behavior:
```typescript
// BAD: any string matches this
expect(result).toBeTruthy();

// BAD: type checks, not behavior checks
expect(typeof result).toBe('object');

// BAD: only checks array-ness, not contents
expect(Array.isArray(result)).toBe(true);
```

**Happy-path-only coverage** — testing only the success case and ignoring errors/edges:
```typescript
// INCOMPLETE: what happens with invalid email? duplicate user? empty password?
describe('createUser', () => {
  it('creates a user', async () => {
    const user = await manager.createUser('test@test.com', 'password');
    expect(user.email).toBe('test@test.com');
  });
  // ...and nothing else
});
```
Every tested function must include at least one test for an error/rejection/edge case. If the function has branches, test both sides.

**Padding tests** — trivial tests added solely to inflate coverage numbers:
```typescript
// BAD: testing a plain getter/setter that has no logic
it('gets the user id', () => {
  user.id = '123';
  expect(user.id).toBe('123');
});
```
Only test getters/setters if they contain logic (validation, transformation, side effects).

### Characterization test requirements

When writing characterization tests before a refactor (Tier 3 tasks), the tests must:

1. **Capture actual current behavior**, including any quirks. Read the code carefully. If `createUser` lowercases the email, test that. If `deleteMessage` silently no-ops on a nonexistent message, test that.

2. **Cover the contract boundaries.** For each public method: what are the valid inputs and expected outputs? What inputs cause errors? What are the preconditions (e.g., user must exist before you can add an API key)?

3. **Exercise state transitions.** The database managers are stateful. Tests must verify sequences: create then retrieve, create then delete then retrieve-returns-nothing, create then update then retrieve-shows-update.

4. **Pin branching behavior.** For the message manager specifically, test multi-level branching scenarios:
   - Linear conversation (A → B → C)
   - Single branch point (A → B1, A → B2)
   - Nested branches (A → B → C1, A → B → C2, A → B2)
   - Active branch path resolution after switching branches
   - Edit-creates-new-branch semantics

### How to verify test quality

After writing tests for a module, run this check:

```bash
# 1. Verify tests pass
npx vitest run path/to/file.test.ts

# 2. Check coverage meets targets
npx vitest run path/to/file.test.ts --coverage

# 3. Mutation test: break the code, verify tests catch it
# For each public method in the module under test:
#   - Change a return value, condition, or operation
#   - Run the tests — at least one MUST fail
#   - Revert the change
# If no test fails when you break a method, you have insufficient coverage of that method.
```

Step 3 (manual mutation testing) is required for Tier 2 and Tier 3 modules. For each module, mutate at least 3 different methods and confirm test failure. Document which mutations you tested in the commit message.

---

## Completed Work

All on branch `feature/testing-infrastructure`.

### Setup (Tasks 1-4)
- **Task 1:** Vitest installed in all 3 workspaces with coverage configs (`3ce08ad`)
- **Task 2:** Shared package schema tests — 474 tests, 100% coverage (`25cb685`)
- **Task 3:** Auth middleware tests — 18 tests, 100% coverage (`006ca26`)
- **Task 4:** WebSocket prompt-utils extraction + tests — 34 tests, 100% coverage (`a1ee748`)

### Tier 1: Pure Functions (Tasks 5-11) — all complete
- **Task 5:** Encryption + error message tests (`4a01592`)
- **Task 6:** Import parser tests (`a38ab8d`)
- **Task 7:** Context strategy tests (`4e9eaa3`)
- **Task 8:** Pricing cache + cache strategy tests (`cd82011`, `ef68f4a`)
- **Task 9:** WebSocket room manager tests (`9bcaa43`)
- **Task 10:** Config loader tests (`4a01592`)
- **Task 11:** Frontend utility tests — 146 tests, 90%+ coverage (`168d5cd`)

### Tier 2: Services & Stores (Tasks 12-20) — all complete
Executed via 3 parallel agents in worktrees:
- **svc-backend** (Tasks 12, 13, 18): Content filter, API key manager, email/persona — 514 tests
- **svc-providers** (Tasks 14, 15): Anthropic, Bedrock, OpenRouter, Gemini, OpenAI-compatible formatting — 197 tests
- **svc-data** (Tasks 16, 17, 19, 20): DB sub-stores, frontend WS, site config

Merged: `feature/t2-backend-svc` (`74e0d68`), `feature/t2-providers` (`661296a`), `feature/t2-data-stores` (`9e7e1fb`)

### Tier 3: Characterization Tests (Tasks 21-29) — mostly complete
Executed via 3 parallel agents in worktrees:
- **db-characterize** (Tasks 21-24): Database user, grant, message/branching, share/permission characterization — all complete
- **orchestrator-tests** (Tasks 25-27): InferenceService complete (118 tests, 85% stmt/78% branch). WS handler (#26) in progress. Frontend store (#27) pending.
- **route-integration** (Tasks 28-29): Auth + conversations + remaining routes — 224 tests, all exceeding 70% stmts / 65% branch targets

Merged: `feature/t3-db-characterize`, `feature/t3-orchestrators` (partial), `feature/t3-routes`

### Quality review + cleanup
- Code review: 28 PASS, 8 WARN, 0 FAIL
- Removed 13 existence-only constructor tests + 1 incomplete test (`2d67c25`)

### Infrastructure fixes
- Root `vitest.config.ts` with `projects: ['backend', 'frontend', 'shared']` for monorepo-root test runs (`70c8147`)
- `test:coverage` scripts use `--reporter=dot --silent` for clean output (`9a97d35`)
- Frontend `avatars.test.ts` changed to relative imports for workspace compat

### Current test count: ~1,366+ passing tests

---

## Tier 1: Pure Functions (no mocking needed)

These modules contain pure logic with no external dependencies. Test them directly.

### Task 5: Backend utilities — encryption + error messages

**Files:**
- Create: `backend/src/utils/encryption.test.ts`
- Create: `backend/src/utils/error-messages.test.ts`

**encryption.ts** (98 lines) — AES-256-GCM encrypt/decrypt:
- Test roundtrip: encrypt then decrypt returns original
- Test different input types (strings, JSON objects)
- Test that encrypted output differs from input
- Test decrypt with wrong key fails
- Test decrypt with tampered ciphertext fails
- Test decrypt with malformed input (missing IV, missing auth tag) fails

**error-messages.ts** (196 lines) — Error message constants:
- Test that each message constant contains expected key phrases
- Test any template/placeholder substitution functions

**Commit:** `test: add encryption and error message utility tests`

---

### Task 6: Import parser

**Files:**
- Create: `backend/src/services/importParser.test.ts`

**importParser.ts** (1,016 lines) — All parsers are pure functions:
- `parseBasicJson()` — test with valid/invalid JSON, missing fields
- `parseAnthropic()` — test with real claude.ai export format
- `parseChromeExtension()` — test with extension export format
- `parseArcChat()` — test with Arc Chat native format
- `parseOpenAI()` — test with ChatGPT export format
- `parseCursor()` — test with Cursor JSON format, chain-of-thought, file attachments
- `parseColonFormat()` — test with `Human: / Assistant:` format
- Test participant detection and deduplication
- Test `MAX_AUTO_DETECTED_PARTICIPANTS` limit
- Test format suggestion/auto-detection logic
- Test title extraction from each format
- Test edge cases: empty conversations, single message, very large conversations

**Commit:** `test: add import parser tests for all conversation formats`

---

### Task 7: Context strategies

**Files:**
- Create: `backend/src/services/context-strategies.test.ts`

**context-strategies.ts** (854 lines) — Pure strategy implementations:
- `estimateTokens()` — test token count estimation for various string lengths
- `getMessageTokens()` — test with different message content types
- `RollingContextStrategy.prepareContext()` — test window rotation, cache marker placement
- `AppendContextStrategy.prepareContext()` — test simple append behavior
- Test with image attachments (should affect token counts)
- Test edge cases: single message, empty history, message exceeding context window
- Test cache marker placement correctness

**Commit:** `test: add context strategy tests`

---

### Task 8: Pricing cache + cache strategies

**Files:**
- Create: `backend/src/services/pricing-cache.test.ts`
- Create: `backend/src/services/cache-strategies.test.ts`

**pricing-cache.ts** (119 lines):
- Test `parsePrice()` with various formats (string, number, null)
- Test cache update and lookup
- Test staleness detection (1-hour TTL)
- Test cache miss returns undefined

**cache-strategies.ts** (207 lines):
- Test cache key generation consistency
- Test breakpoint computation
- Test token savings calculation

**Commit:** `test: add pricing and cache strategy tests`

---

### Task 9: WebSocket room manager

**Files:**
- Create: `backend/src/websocket/room-manager.test.ts`

**room-manager.ts** (~80 lines) — Pure state management on Maps:
- Test room creation when user joins
- Test multiple users in same room
- Test user disconnection removes from room
- Test room cleanup when last user leaves
- Test active request tracking per room
- Test listing users in a room

**Commit:** `test: add room manager tests`

---

### Task 10: Config loaders

**Files:**
- Create: `backend/src/config/loader.test.ts`
- Create: `backend/src/config/model-loader.test.ts`

Test with `CONFIG_PATH` env var pointing to a temp test config file (use the scratchpad directory). Reset singletons between tests.

**loader.ts:**
- Test loading valid config
- Test defaults applied for missing fields
- Test `reloadConfig()` picks up changes
- Test missing config file produces useful error

**model-loader.ts:**
- Test `getModelById()` returns correct model
- Test `getModelsByProvider()` filters correctly
- Test `getAllModels()` returns full list
- Test user-defined model merging
- Test missing model returns undefined

**Commit:** `test: add config loader tests`

---

### Task 11: Frontend utilities — authenticity, modelColors, latex, avatars

**Files:**
- Create: `frontend/src/utils/authenticity.test.ts`
- Create: `frontend/src/utils/modelColors.test.ts`
- Create: `frontend/src/utils/latex.test.ts`
- Create: `frontend/src/utils/avatars.test.ts`

**authenticity.ts** (212 lines):
- Test `computeAuthenticity()` with verified, modified, and unverified messages
- Test legacy message detection
- Test name collision detection
- Test post-hoc operation detection
- Test `getAuthenticityLevel()`, `getAuthenticityColor()`, `getAuthenticityTooltip()` mappings

**modelColors.ts** (208 lines):
- Test exact model name matches
- Test pattern-based matching (opus, sonnet, haiku, gemini)
- Test fallback to default color
- Test `getLighterColor()` hex-to-RGBA conversion with various opacities

**latex.ts** (100 lines):
- Test display math rendering (`$$ ... $$`, `\[ ... \]`)
- Test inline math rendering (`$ ... $`, `\( ... \)`)
- Test escaped delimiter handling (should NOT render)
- Test error recovery (malformed LaTeX returns original)
- Test skip optimization (no delimiters = no processing)

**avatars.ts** (180 lines):
- Test `getAvatarUrl()` pack lookup and URL construction
- Test `getParticipantAvatarUrl()` resolution order (participant > persona > model)
- Test `getParticipantColor()` resolution order
- Test fallback to defaults
- Test `getModelAvatarUrl()` canonicalId derivation

**Commit:** `test: add frontend utility tests`

---

## Tier 2: Services & Stores (mock one layer)

These modules have external dependencies (DB, APIs, filesystem) but contain significant testable logic. Mock the outermost dependency and test the real logic.

### Task 12: Content filter

**Files:**
- Create: `backend/src/services/content-filter.test.ts`

**content-filter.ts** (277 lines) — Mock the moderation API call, test the decision logic:
- Test always-blocked categories (CSAM, self-harm instructions)
- Test age-restricted categories
- Test researcher exemptions
- Test threshold-based scoring (above/below/at threshold)
- Test category score aggregation
- Test when moderation API is disabled (config flag)

**Commit:** `test: add content filter tests`

---

### Task 13: API key manager

**Files:**
- Create: `backend/src/services/api-key-manager.test.ts`

**api-key-manager.ts** (250 lines) — Mock the Database, test key selection logic:
- Test priority ordering: user key > config key > env var
- Test provider detection from model config
- Test user vs system key selection
- Test fallback when no keys available
- Test key validation (format checks)

**Commit:** `test: add API key manager tests`

---

### Task 14: Provider message formatting — Anthropic + Bedrock

**Files:**
- Create: `backend/src/services/anthropic.test.ts`
- Create: `backend/src/services/bedrock.test.ts`

Test message formatting functions ONLY (not API calls). Mock the Database for constructor.

**anthropic.ts** (896 lines):
- Test user message formatting
- Test assistant message formatting
- Test system prompt handling
- Test multi-turn conversation ordering
- Test image/vision content block creation
- Test `compressImage()` with various sizes
- Test cache control marker placement
- Test thinking block handling

**bedrock.ts** (463 lines):
- Test Bedrock-specific message formatting
- Test content block assembly
- Test AWS credential parameter building

**Commit:** `test: add Anthropic and Bedrock formatting tests`

---

### Task 15: Provider message formatting — OpenRouter, Gemini, OpenAI-compatible

**Files:**
- Create: `backend/src/services/openrouter.test.ts`
- Create: `backend/src/services/gemini.test.ts`
- Create: `backend/src/services/openai-compatible.test.ts`

**openrouter.ts** (1,035 lines):
- Test model list parsing and filtering
- Test pricing extraction and fallback logic
- Test request formatting for OpenRouter API
- Test rate limit detection in error responses

**gemini.ts** (722 lines):
- Test content formatting for Gemini API
- Test thinking mode configuration
- Test vision content handling
- Test thinking block extraction from responses

**openai-compatible.ts** (323 lines):
- Test request builder with custom endpoints
- Test model ID mapping
- Test response parsing

**Commit:** `test: add OpenRouter, Gemini, and OpenAI-compatible formatting tests`

---

### Task 16: Database sub-stores — persistence, blob-store, collaboration, shares

**Files:**
- Create: `backend/src/database/persistence.test.ts`
- Create: `backend/src/database/blob-store.test.ts`
- Create: `backend/src/database/collaboration.test.ts`
- Create: `backend/src/database/shares.test.ts`

Use temp directories in the scratchpad for file I/O tests. Clean up in `afterEach`.

**persistence.ts** (99 lines):
- Test JSON serialization roundtrip
- Test JSONL line parsing
- Test empty file handling
- Test malformed line handling (corrupted data)
- Test large event append + load

**blob-store.ts** (250 lines):
- Test blob save and retrieve by hash
- Test duplicate detection (same content = same hash)
- Test size limit enforcement
- Test MIME type handling
- Test deletion

**collaboration.ts** (478 lines):
- Test share creation and revocation
- Test invite token generation and validation
- Test expiration enforcement
- Test permission inheritance
- Test event replay produces same state

**shares.ts** (190 lines):
- Test public share creation and access
- Test token uniqueness
- Test expiration logic
- Test metadata updates

**Commit:** `test: add database sub-store tests`

---

### Task 17: Database sub-stores — persona, conversation-ui-state

**Files:**
- Create: `backend/src/database/persona.test.ts`
- Create: `backend/src/database/conversation-ui-state.test.ts`

**persona.ts** (829 lines):
- Test persona CRUD
- Test history branch management
- Test participation tracking and ordering
- Test fork/merge operations
- Test head branch management

**conversation-ui-state.ts** (268 lines):
- Test state save and load
- Test version tracking
- Test default state initialization

**Commit:** `test: add persona and conversation UI state tests`

---

### Task 18: Email service + persona context builder

**Files:**
- Create: `backend/src/services/email.test.ts`
- Create: `backend/src/services/persona-context-builder.test.ts`

**email.ts** (244 lines) — Mock the Resend API:
- Test email template rendering (verification, password reset, invite)
- Test subject line generation
- Test recipient validation
- Test template variable substitution

**persona-context-builder.ts** (313 lines) — Mock the Database:
- Test history traversal and chronological ordering
- Test canonical message extraction
- Test backscroll assembly
- Test context size limits
- Test with no history (empty context)

**Commit:** `test: add email and persona context builder tests`

---

### Task 19: Frontend WebSocket service

**Files:**
- Create: `frontend/src/services/websocket.test.ts`

**websocket.ts** (~400 lines) — Mock the WebSocket constructor and document.visibilityState:
- Test event handler registration and emission
- Test message queuing when disconnected
- Test reconnection with exponential backoff (verify delay increases)
- Test max reconnect attempts
- Test intentional disconnect skips reconnection
- Test keep-alive ping interval
- Test visibility change handler (tab hidden → tab visible triggers reconnect check)
- Test clean disconnect (`close()`)

**Commit:** `test: add WebSocket service tests`

---

### Task 20: Frontend site config composable

**Files:**
- Create: `frontend/src/composables/useSiteConfig.test.ts`

**useSiteConfig.ts** (105 lines):
- Test single load promise (prevents duplicate fetches)
- Test caching of loaded config
- Test default fallback on API error
- Test reload functionality

**Commit:** `test: add site config composable tests`

---

## Tier 3: Characterization Tests (test existing code WITHOUT changing it)

Do NOT extract or refactor anything in this tier. The goal is regression safety: test the current behavior of the large modules so that future refactoring is protected. These tests exercise the real code through its public API.

For `database/index.ts`, instantiate a real Database with a temp data directory (scratchpad). For `inference.ts` and `handler.ts`, mock only the outermost layer (API calls, WebSocket sends) and let the real logic run.

### Task 21: Characterization tests — Database user operations

**Files:**
- Create: `backend/src/database/index.user.test.ts`

Instantiate a real Database with a temp data directory. Test the public API as-is:
- `createUser()` → user exists in `getUserById()` and `getUserByEmail()`
- `createUser()` with duplicate email throws
- `getUserByEmail()` is case-insensitive
- `updateUser()` changes are visible in subsequent `getUserById()`
- `updateUserPassword()` → old password no longer works, new one does
- Email verification: `verifyEmail()` with correct/wrong/expired token
- Password reset: `requestPasswordReset()` → `resetPassword()` flow
- State survives event replay: create user, reload DB from same data dir, user still exists

Clean up temp directory in `afterAll`.

**Commit:** `test: add Database user operation characterization tests`

---

### Task 22: Characterization tests — Database grant operations

**Files:**
- Create: `backend/src/database/index.grant.test.ts`

Same approach — real Database with temp data dir:
- `mintGrant()` → `getUserGrants()` shows it
- `consumeGrant()` reduces balance in `getGrantSummary()`
- Consume with insufficient balance fails/returns error
- Multiple grants for same currency aggregate correctly
- Grant summary reflects all currencies
- Consume prioritizes oldest grants (verify FIFO if applicable)
- Zero-amount edge cases

**Commit:** `test: add Database grant operation characterization tests`

---

### Task 23: Characterization tests — Database message + branching

**Files:**
- Create: `backend/src/database/index.message.test.ts`

This is the most critical test file. Real Database with temp data dir. Create a conversation, then test branching:
- `addMessage()` → message appears in `getConversationMessages()`
- Linear conversation (A → B → C): `getMessagePath()` returns [A, B, C]
- Single branch (A → B1, A → B2): path follows active branch
- `switchActiveBranch()` changes which branch `getMessagePath()` follows
- Nested branches (A → B → C1, A → B → C2, A → B2): deep branch switching
- `editMessage()` creates a new branch on the same parent
- `deleteMessage()` removes branch, preserves siblings
- `deleteAllBranches()` removes all siblings
- Post-hoc hide: hidden message excluded from relevant queries
- Post-hoc edit: edited content visible in relevant queries
- Edge cases: delete last branch, edit root message, empty conversation

**Commit:** `test: add Database message and branching characterization tests`

---

### Task 24: Characterization tests — Database share + permission operations

**Files:**
- Create: `backend/src/database/index.share.test.ts`

Real Database with temp data dir, two users:
- `shareConversation()` → shared user can access via `canUserAccessConversation()`
- `unshareConversation()` → access revoked
- Permission levels: view-only user can't edit, edit user can
- Owner always has full access
- `createPublicShare()` → `getPublicShare()` returns it
- `revokePublicShare()` → no longer accessible
- Stranger (no share) denied access
- `getUserPermissionLevel()` returns correct level for owner, shared user, public, stranger

**Commit:** `test: add Database share and permission characterization tests`

---

### Task 25: Characterization tests — InferenceService formatting

**Files:**
- Create: `backend/src/services/inference.test.ts`

Mock the Database (provide fake conversation/message/participant data), mock API clients (Anthropic SDK, etc.), but let the real InferenceService logic run:
- `determineActualFormat()` returns correct format for different model+participant combinations
- `applyPostHocOperations()` correctly filters/modifies messages
- Message formatting produces correct structure for each provider format
- System prompt insertion works
- Persona context is included when applicable
- Edge cases: empty conversation, single message, system prompt only

**Commit:** `test: add InferenceService characterization tests`

---

### Task 26: Characterization tests — WebSocket handler

**Files:**
- Create: `backend/src/websocket/handler.test.ts`

Mock the WebSocket `send()` and the InferenceService streaming. Let handler logic run:
- Conversation history building follows active branch
- Hidden messages are filtered from AI context
- Generation abort: starting a new generation for same user+conversation aborts previous
- Generation cleanup on end
- Message validation rejects malformed WebSocket messages
- Room joining/leaving state management

**Commit:** `test: add WebSocket handler characterization tests`

---

### Task 27: Characterization tests — frontend store

**Files:**
- Create: `frontend/src/store/index.test.ts`

Mock the API service (`vi.mock('@/services/api')`). Test store actions and getters:
- Message visibility: correct messages returned based on active branch state
- Branch switching updates visible messages
- Detached mode toggling
- Unread count calculation
- Model availability based on user keys + system models
- Grant summary updates
- Login/logout state transitions

**Commit:** `test: add frontend store characterization tests`

---

### Task 28: Route integration tests — auth + conversations

**Files:**
- Create: `backend/src/routes/auth.test.ts`
- Create: `backend/src/routes/conversations.test.ts`

Integration tests using supertest against the Express app. Real Database with temp data dir.

Create a test helper that:
- Instantiates Database with a temp data directory
- Creates a minimal Express app with the routes under test
- Provides helper functions for auth (create user, get token)
- Cleans up temp directory in `afterAll`

**auth routes:**
- Register → login → get profile
- Reject duplicate registration
- Reject invalid credentials
- Token refresh flow

**conversation routes:**
- Create conversation → list shows it
- Get conversation by ID
- Update conversation title
- Delete conversation → list no longer shows it
- Permission checks (can't access other user's conversation)

Install supertest: `npm install -D supertest @types/supertest -w backend`

**Commit:** `test: add auth and conversation route integration tests`

---

### Task 29: Route integration tests — remaining routes

**Files:**
- Create: `backend/src/routes/participants.test.ts`
- Create: `backend/src/routes/bookmarks.test.ts`
- Create: `backend/src/routes/models.test.ts`
- Create: `backend/src/routes/site-config.test.ts`
- Create: `backend/src/routes/system.test.ts`

Using the same test helper from Task 28:

**participants:** Add/remove participant, permission checks
**bookmarks:** Create/delete bookmark, list by conversation
**models:** List available models, model availability per user
**site-config:** Load config, defaults
**system:** Health check returns 200

**Commit:** `test: add remaining route integration tests`

---

## Tier 3+: Provider Streaming Characterization (Tasks 30-34) — NEW

Provider formatting tests (Tier 2) only covered message formatting functions. The streaming/API orchestration code (streamChat, request building, error handling, response parsing) remains untested, leaving whole-file coverage well below targets:

| File | Current stmts | Target |
|------|--------------|--------|
| anthropic.ts | 45.7% | 80% |
| bedrock.ts | 64.3% | 80% |
| gemini.ts | 22.3% | 80% |
| openai-compatible.ts | 32.1% | 80% |
| openrouter.ts | 30.0% | 80% |

Approach: Mock the SDK/fetch layer, let the real streaming orchestration logic run. Characterization tests — capture actual behavior including quirks.

### Task 30: Provider characterization — anthropic.ts streaming + request building
Mock Anthropic SDK client. Test: streamChat orchestration, request building (model params, system prompt, tool use), streaming event handling (content_block_start/delta/stop, message_start/delta/stop), error handling, token counting, cache control, thinking support.

### Task 31: Provider characterization — bedrock.ts streaming + request building
Mock AWS Bedrock SDK. Test: streamChat orchestration, InvokeModelWithResponseStreamCommand construction, streaming chunk parsing, content block assembly, error handling, credential/region handling, model ID mapping.

### Task 32: Provider characterization — gemini.ts streaming + request building
Mock Google Generative AI SDK. Test: streamChat orchestration, generation config, safety settings, system instruction handling, streaming response handling, tool/function calling, error handling, token counting.

### Task 33: Provider characterization — openai-compatible.ts streaming + request building
Mock fetch. Test: streamChat orchestration, request building (headers, body), SSE streaming response parsing, thinking tag extraction from streamed responses, error handling, token counting.

### Task 34: Provider characterization — openrouter.ts streaming + request building
Mock fetch. Test: streamChat orchestration, request building (headers: HTTP-Referer, X-Title, provider preferences), SSE streaming parsing, model routing/fallback, thinking tag extraction, generation stats parsing, error handling, rate limiting, token counting. Largest file (1035 lines).

---

## Tier 4: Remaining Routes & Backend Coverage (Tasks 35-41)

The routes tested in Tasks 28-29 covered 7 of 18 route files. The remaining 11 route files plus key backend modules are untested. Same approach: supertest integration tests with real Database + temp data dir, using the `test-helpers.ts` from Task 28.

**Coverage targets:** Routes 70% stmts / 65% branches. Services 80% stmts / 75% branches.

**Excluded from testing (not worth it):**
- `backend/src/index.ts` — server entry point, pure wiring
- `backend/src/config/types.ts` — type definitions only, no runtime code
- `backend/src/utils/logger.ts` (72 lines) — thin `console.*` wrappers
- `backend/src/utils/llmLogger.ts` (136 lines) — file I/O logging utility
- `backend/src/utils/openrouterLogger.ts` (198 lines) — logging utility
- `backend/src/services/cache-example.ts` — example/demo code
- `frontend/src/main.ts` — Vue app bootstrap, pure wiring
- `frontend/src/services/api.ts` (39 lines) — Axios wrapper, too thin

---

### Task 35: Route integration tests — admin

**Files:**
- Create: `backend/src/routes/admin.test.ts`

**admin.ts** (580 lines) — Admin-only routes with `requireAdmin` middleware:
- Test `requireAdmin` middleware rejects non-admin users (403)
- `GET /api/admin/users` — list all users with stats (conversation count, message count, last active)
- `POST /api/admin/users/:id/capabilities` — grant/revoke capabilities (admin, mint, send, overspend, researcher)
- `POST /api/admin/users/:id/credits` — mint credits for a user
- `GET /api/admin/users/:id/grants` — view user's grant history
- `GET /api/admin/stats` — system-wide statistics
- `POST /api/admin/invites` — create invite codes
- `DELETE /api/admin/invites/:id` — revoke invite
- Permission checks: non-admin can't access any admin endpoint
- Validation: reject invalid capability names, negative credit amounts

**Commit:** `test: add admin route integration tests`

---

### Task 36: Route integration tests — personas

**Files:**
- Create: `backend/src/routes/personas.test.ts`

**personas.ts** (557 lines) — Persona CRUD + history branching + sharing:
- `POST /api/personas` — create persona with Zod-validated schema
- `GET /api/personas` — list user's personas
- `GET /api/personas/:id` — get persona details
- `PUT /api/personas/:id` — update persona
- `DELETE /api/personas/:id` — delete persona (owner only)
- `POST /api/personas/:id/join` — join persona to conversation
- `POST /api/personas/:id/leave` — leave conversation
- `POST /api/personas/:id/fork` — fork history branch
- `POST /api/personas/:id/share` — share with another user
- `PUT /api/personas/:id/shares/:shareId` — update share permission
- `DELETE /api/personas/:id/shares/:shareId` — revoke share
- Permission checks: can't modify other user's persona, shared users respect permission level
- `PUT /api/personas/:id/canonical-branch` — set canonical branch
- `PUT /api/personas/:id/logical-time` — update logical time range

**Commit:** `test: add persona route integration tests`

---

### Task 37: Route integration tests — collaboration + invites

**Files:**
- Create: `backend/src/routes/collaboration.test.ts`
- Create: `backend/src/routes/invites.test.ts`

**collaboration.ts** (371 lines) — Conversation sharing & collaboration:
- `GET /api/collaboration/invites/token/:token` — public invite lookup
- `POST /api/collaboration/invites/:token/redeem` — redeem invite (auth required)
- `GET /api/collaboration/conversations/:id/collaborators` — list collaborators
- `POST /api/collaboration/conversations/:id/invite` — create invite link
- `DELETE /api/collaboration/conversations/:id/collaborators/:userId` — remove collaborator
- `PUT /api/collaboration/conversations/:id/collaborators/:userId` — update permission
- Permission checks: only owner can invite/remove, collaborators see limited data

**invites.ts** (156 lines) — Invite code management:
- `POST /api/invites` — create invite code
- `GET /api/invites/:code` — validate invite code
- `POST /api/invites/:code/redeem` — redeem invite for registration
- Expiration enforcement, max-uses tracking

**Commit:** `test: add collaboration and invite route integration tests`

---

### Task 38: Route integration tests — import, shares, custom-models

**Files:**
- Create: `backend/src/routes/import.test.ts`
- Create: `backend/src/routes/shares.test.ts`
- Create: `backend/src/routes/custom-models.test.ts`

**import.ts** (644 lines) — Import/export:
- `POST /api/import/preview` — preview import with format detection
- `POST /api/import/execute` — execute import, creates conversation + messages
- `POST /api/import/export/:conversationId` — export conversation
- Test with multiple formats (basicJson, anthropic, arcChat)
- Validation: reject invalid format, missing content, unauthorized

**shares.ts** (232 lines) — Public share management:
- `POST /api/shares/create` — create share with Zod-validated schema
- `GET /api/shares/:token` — get share by token (public, no auth)
- `GET /api/shares/user/list` — list user's shares
- `DELETE /api/shares/:id` — delete share
- Expiration, view counting, download settings

**custom-models.ts** (387 lines) — User-defined models CRUD:
- `GET /api/custom-models` — list user's custom models
- `GET /api/custom-models/:id` — get specific model
- `POST /api/custom-models` — create custom model (Zod schema)
- `PUT /api/custom-models/:id` — update model
- `DELETE /api/custom-models/:id` — delete model
- User isolation: can't see/modify other user's models

**Commit:** `test: add import, shares, and custom-models route integration tests`

---

### Task 39: Route integration tests — avatars, blobs, prompt, public-models

**Files:**
- Create: `backend/src/routes/avatars.test.ts`
- Create: `backend/src/routes/blobs.test.ts`
- Create: `backend/src/routes/prompt.test.ts`
- Create: `backend/src/routes/public-models.test.ts`

**avatars.ts** (532 lines) — Avatar upload with Sharp image processing:
- `GET /api/avatars/packs` — list avatar packs
- `GET /api/avatars/:pack/:name` — serve avatar image
- `POST /api/avatars/upload` — upload custom avatar (file handling, thumbnail generation)
- `DELETE /api/avatars/:id` — delete user avatar
- MIME type validation, size limits, thumbnail sizing

**blobs.ts** (99 lines) — Immutable blob storage:
- `GET /api/blobs/:id` — serve blob with ETag caching
- UUID validation, conditional request handling (304 Not Modified)

**prompt.ts** (133 lines) — Prompt building for inference:
- `POST /api/prompt/build` — build conversation prompt from branch history
- Participant filtering, responder selection

**public-models.ts** (101 lines) — Public model info:
- `GET /api/public-models` — model pricing and availability
- Cost formatting, currency extraction

**Commit:** `test: add avatars, blobs, prompt, and public-models route integration tests`

---

### Task 40: Database utilities — compaction, migration, fix-branches

**Files:**
- Create: `backend/src/database/compaction.test.ts`
- Create: `backend/src/database/migration.test.ts`
- Create: `backend/src/database/fix-branches.test.ts`

**compaction.ts** (263 lines) — Event log compaction:
- `compactEventLog()` with default options removes `active_branch_changed` and `message_order_changed` events
- `stripDebugData` removes `debugRequest`/`debugResponse` from events
- `moveDebugToBlobs` moves stripped debug data to blob store
- `createBackup` creates `.bak` file before compacting
- Size reporting: original vs compacted size and event counts
- Test with temp files in scratchpad directory
- Edge cases: empty event log, all events removable, no removable events

**migration.ts** (137 lines) — Event redistribution:
- Event categorization by type to correct store files
- Store routing for conversation, user, grant, share events
- Edge cases: unknown event type handling

**fix-branches.ts** (36 lines) — Branch repair:
- Validates `activeBranchId` references valid branch
- Repairs invalid references
- No-op when branches are valid

**Commit:** `test: add compaction, migration, and fix-branches tests`

---

### Task 41: Context manager service

**Files:**
- Create: `backend/src/services/context-manager.test.ts`

**context-manager.ts** (360 lines) — Context window management with caching:
- `getContextForConversation()` — builds context window with strategy selection
- Strategy switching based on conversation settings (rolling vs append)
- Cache key tracking per message
- Cache hit/miss statistics
- `invalidateCache()` clears cached state
- Persona context integration via PersonaContextBuilder
- Edge cases: conversation with no messages, strategy change mid-conversation, cache expiration

Mock the Database and PersonaContextBuilder. Let the real ContextManager + ContextStrategy logic run.

**Commit:** `test: add context manager characterization tests`

---

### Task 42: Config — site-config-loader coverage improvement

**Files:**
- Modify: `backend/src/config/loader.test.ts` (add site-config-loader tests)

**site-config-loader.ts** (106 lines, currently 54.83% stmts):
- Singleton pattern: second call returns cached config
- File loading with JSON parse
- Fallback defaults on missing/malformed file
- Environment-specific config merging (dev vs prod)
- `reloadSiteConfig()` clears cache

**Commit:** `test: improve site-config-loader coverage`

---

## Summary

| Tier | Tasks | What | Status |
|------|-------|------|--------|
| Setup | 1-4 | Vitest, shared schemas, auth, prompt-utils | **Complete** |
| 1: Pure | 5-11 | Utilities, parsers, strategies, configs, frontend utils | **Complete** |
| 2: Services | 12-20 | Content filter, API keys, providers (formatting), DB sub-stores, email, WS client | **Complete** |
| 3: Characterization | 21-29 | Database, inference, handler, store, routes (7 of 18) | **Complete** (26 done, 27 in progress) |
| 3+: Provider streaming | 30-34 | Provider streaming/API orchestration characterization | **Complete** |
| 4: Remaining coverage | 35-42 | Remaining 11 routes, DB utilities, context manager, config | **Pending** |

**No source code is modified until all tiers are complete.** Refactoring (extracting managers, splitting stores, etc.) is a separate plan that builds on this regression safety net.

**Parallelization:** Tier 4 tasks are independent. Recommended groupings for 3 parallel agents:
- **Agent A (routes-heavy):** Tasks 35, 36 (admin + personas — largest routes, 580+557 lines)
- **Agent B (routes-collab):** Tasks 37, 38 (collaboration + invites + import + shares + custom-models)
- **Agent C (routes-misc + backend):** Tasks 39, 40, 41, 42 (smaller routes + DB utilities + context manager + config)

**Total:** 42 tasks. 33 complete, 1 in progress (#27 frontend store), 8 pending (Tier 4).
