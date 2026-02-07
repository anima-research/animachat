# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arc Chat is a multi-agent conversation platform with conversation branching, multi-provider AI model support, real-time WebSocket streaming, and collaborative editing. The app lives in `deprecated-claude-app/` as a TypeScript monorepo with three workspaces: **backend**, **frontend**, and **shared**.

## Build & Development Commands

All commands run from `deprecated-claude-app/`:

```bash
npm run dev              # Start both backend + frontend concurrently
npm run dev:backend      # Backend only (tsx watch on localhost:3010)
npm run dev:frontend     # Frontend only (Vite dev server, proxies API to :3010)
npm run build            # Build all workspaces in order: shared → backend → frontend
```

Individual workspace commands:
```bash
npm run build -w shared    # Build shared types first (required before backend/frontend)
npm run build -w backend
npm run build -w frontend
```

There is no formal test suite. Manual test scripts exist in `deprecated-claude-app/backend/` (test-context-management.js, test-encryption.js, test-full-flow.js, etc.).

## Monorepo Architecture

```
deprecated-claude-app/
├── shared/     # TypeScript types + Zod schemas (built first, consumed by both)
├── backend/    # Express + WebSocket server (Node.js, ES modules)
├── frontend/   # Vue 3 + Vuetify SPA (Vite)
└── package.json  # Workspace root
```

**Shared** exports all types from `src/index.ts`: core types (`types.ts`), API schemas (`api-types.ts`), grant types (`grants.ts`), sharing types (`sharing.ts`), import formats (`import-types.ts`). Both backend and frontend import from `shared`.

## Backend Architecture

**Entry point:** `backend/src/index.ts` — Express server with WebSocket upgrade support.

Key directories:
- **database/** — Custom file-based event-sourcing persistence. The main `index.ts` (~5400 lines) is the primary database class. Events are appended to log files; snapshots support large conversations. Also includes blob storage, compaction, collaboration store, persona store, and shares.
- **services/** — Business logic for AI providers (anthropic.ts, bedrock.ts, openrouter.ts, gemini.ts, openai-compatible.ts), inference orchestration (inference.ts), API key management, content filtering, context management, cache strategies, import parsing, and pricing.
- **routes/** — 18 Express route files covering auth, conversations, models, participants, admin, personas, collaboration, shares, bookmarks, invites, avatars, blobs, import, site-config, and system.
- **websocket/** — `handler.ts` for message routing/streaming, `room-manager.ts` for conversation state.
- **config/** — `models.json` (complete model registry with context windows, pricing, capabilities), `config.example.json` (provider credentials, feature flags, grants).

**Configuration:** Backend reads from `backend/config/config.json` (copy from `config.example.json`). Contains provider API keys, model cost tracking, currency definitions, feature flags, and initial grants.

## Frontend Architecture

**Entry point:** `frontend/src/main.ts` — Vue 3 app with Vuetify, Vue Router, dark theme default.

Key directories:
- **components/** — 33 Vue components. Major ones: ConversationView, ConversationTree, Message components (CompositeMessageGroup), ImportDialogV2, SettingsDialog, ParticipantsSection, Personas management, Grants/Credits management.
- **services/** — `api.ts` (Axios client with auth interceptor), `websocket.ts` (auto-reconnection, Safari multi-tab fixes, visibility tracking, keep-alive pinging).
- **store/** — Pinia/Vue state for user auth, conversations, messages, model availability, WebSocket state, branch mode, read tracking, grants.
- **views/** — Page components for login, conversation, admin, personas, archive, sharing, etc.
- **utils/** — Avatar management, authenticity verification, LaTeX rendering, model color coding.

**Vite config:** Path alias `@/*` → `./src/*`. API proxy to `http://localhost:3010`. Vuetify auto-import enabled.

## Key Architectural Patterns

- **Event sourcing:** All data persisted as append-only events with snapshot support. No SQL database — fully file-based.
- **Conversation branching:** Messages form a tree structure. Users can edit any message to create parallel branches, fork conversations, and regenerate responses.
- **Multi-provider inference:** Unified inference service routes to Anthropic, AWS Bedrock, OpenRouter, OpenAI-compatible, or Google Gemini based on model selection and user API keys.
- **Stepped rolling context:** Optimization strategy for prompt caching across conversation turns.
- **WebSocket streaming:** Real-time token streaming from AI providers to clients, with room-based multiplexing for collaborative sessions.
- **JWT auth:** Token-based authentication with bcrypt password hashing and encrypted API key storage.
- **Grant/credit system:** Admin-subsidized model access with configurable currencies (Sonnets, Opus, etc.) and per-model cost tracking.

## Deployment

GitHub Actions deploys to three environments:
- **Staging:** Auto-deploys on main push (arcstaging.animalabs.ai:3012)
- **Production-A:** arc.animalabs.ai:3010 (on version tags)
- **Production-B:** arc.at-hub.com:3011 (on version tags)

Deployment builds all workspaces, copies artifacts via SCP, installs deps, starts systemd services, and runs health checks.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, Vuetify, Vite, TypeScript, Vue Router, Axios |
| Backend | Express, ws (WebSockets), TypeScript, Node.js ES modules |
| Validation | Zod (shared schemas) |
| AI SDKs | @anthropic-ai/sdk, @aws-sdk/client-bedrock-runtime |
| Rendering | Marked (markdown), PrismJS (syntax), KaTeX (math), DOMPurify |
| Auth | JWT, bcrypt |
| Email | Resend |
