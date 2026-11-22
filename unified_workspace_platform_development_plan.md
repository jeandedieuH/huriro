# Unified Workspace Platform: Architecture & Development Plan

## 1. Executive Overview

This document outlines the complete architecture, database schema, inter-process communication contracts, single-server deployment stack, and 16-week engineering roadmap for building a self-hosted and cloud-ready unified workspace platform from scratch.

The platform consolidates five core modules into a single high-performance system:

1. **Tasks:** Projects with custom workflows, Kanban boards (fractional indexing), list/timeline views, sub-issues, and two-way GitHub synchronization.
2. **Docs:** Hierarchical page trees (`ltree`), real-time multi-cursor collaborative editing (`yrs` / Yjs CRDTs), version history, and full-text + semantic search.
3. **Chat:** Real-time channels, direct messages, threads, file attachments, and interactive inline previews for linked tasks and documents.
4. **Shared Team Inbox (Mail):** Native email client powered by **Stalwart Mail Server** over **JMAP**, linking customer email threads directly to internal tasks and specs.
5. **AI & Model Context Protocol (MCP):** Built-in OAuth 2.1 `/mcp` server over Streamable HTTP giving AI agents (Claude, Cursor, internal assistants) scoped read/write access across the entire workspace context.

---

## 2. Technology Stack & Code-Sharing Matrix

To maximize developer velocity while maintaining native performance across Web, Mobile, Desktop, and Backend, the platform uses a **polyglot Bun (TypeScript) + Cargo (Rust) monorepo**.

| Layer / Target                         | Runtime & Framework                               | Shared Dependencies                                | Primary Protocols                    | Deployment Target                             |
| :------------------------------------- | :------------------------------------------------ | :------------------------------------------------- | :----------------------------------- | :-------------------------------------------- |
| **Web Client** (`apps/web`)            | Bun, TanStack Start, React 19, TipTap / BlockNote | `packages/eden-client`, `packages/shared`          | HTTPS (Eden Treaty), WSS (`yjs`)     | Dokploy (`dokploy-network` via Traefik)       |
| **API & MCP Server** (`apps/api`)      | Bun, ElysiaJS, Drizzle ORM, TypeBox               | `packages/db`, `packages/proto`, `packages/shared` | REST, Streamable HTTP (`/mcp`), gRPC | Dokploy container (Stateless HTTP)            |
| **Mobile App** (`apps/mobile`)         | React Native, Expo SDK, Expo Router               | `packages/eden-client`, `packages/shared`          | HTTPS Bearer Auth, WSS, `op-sqlite`  | EAS Build / App Store & Play Store            |
| **Desktop App** (`apps/desktop`)       | Rust, Rune GPU UI (`anomalyco/rune`), `rune-rs`   | `crates/workspace-core`, `crates/proto`            | Native WSS, HTTPS, Local SQLite FTS5 | GitHub Releases (`.dmg`, `.msi`, `.AppImage`) |
| **Sync Engine** (`crates/sync-engine`) | Rust, Tokio, Axum, Tonic, `yrs`                   | `crates/workspace-core`, `crates/proto`            | WSS (Clients), gRPC (from ElysiaJS)  | Dokploy container (Stateful in-memory)        |
| **Shared Inbox** (`stalwart`)          | Stalwart Mail Server (Rust binary)                | Mapped via `mail_thread_links` in PG17             | JMAP (HTTP/JSON), SMTP, IMAP         | Dokploy container (`25`, `465`, `587`, `993`) |

---

## 3. Monorepo Directory Blueprint

```text
workspace-platform/
├── apps/
│   ├── api/                  # Bun + ElysiaJS REST API, OAuth 2.1, JMAP bridge & /mcp server
│   ├── web/                  # TanStack Start SSR/SPA web client
│   ├── mobile/               # React Native + Expo mobile client (iOS & Android)
│   └── desktop/              # Native GPU-rendered desktop app built with Rust + Rune
├── packages/
│   ├── db/                   # PostgreSQL 17 schema (Drizzle), migrations, ltree & pgvector helpers
│   ├── eden-client/          # Exported Elysia Eden Treaty client for Web & Expo Mobile
│   ├── proto/                # Protobuf definitions for ElysiaJS <-> Rust gRPC
│   └── shared/               # TypeBox schemas, RBAC bitmasks, fractional-indexing utilities
├── crates/
│   ├── workspace-core/       # Shared Rust library: yrs CRDT state, local SQLite cache, WSS sync client
│   ├── sync-engine/          # Server Rust binary: Stateful WebSocket gateway + Tonic gRPC server
│   └── rune-plugins/         # Embedded rune-rs scripting VM for user workflow automations
├── deploy/
│   ├── .env.example          # Environment variable template for Dokploy / Docker Compose
│   └── docker-compose.yml    # Single-server Dokploy production stack (Traefik-routed)
├── Cargo.toml                # Rust workspace root (apps/desktop + crates/*)
└── package.json              # Bun workspace root (apps/api, apps/web, apps/mobile, packages/*)
```

---

## 4. Core Architectural Pillars

### 4.1 Stateful WebSocket Gateway vs. Stateless REST API

Client traffic is split into two distinct planes:

- **Stateless API Plane (`apps/api` — Bun + ElysiaJS):** Handles authentication, RBAC permission verification, database transactions, JMAP mail querying, and MCP tool execution.
- **Stateful Sync Plane (`crates/sync-engine` — Rust):** Holds persistent WebSocket connections, ephemeral chat typing/presence states, and in-memory `yrs::Doc` rooms for live document editing.

### 4.2 High-Water Sequence WebSocket Sync (Zero-Payload Invalidation)

To keep server memory minimal and ensure strict authorization on every read:

1. **Transactional Sequence Log:** Every create, update, or delete mutation in ElysiaJS writes the entity change and appends a row to `workspace_events` (`BIGSERIAL`) inside the **same PostgreSQL transaction**.
2. **Coalesced 1-Second Broadcast:** ElysiaJS notifies the Rust Sync Engine via gRPC (`NotifySequenceAdvance`). The Rust engine coalesces updates and broadcasts only the latest high-water sequence integer (`{ workspaceId, seq }`) once per second to connected workspace sockets.
3. **Authorized Delta Fetch:** Clients compare their local sequence cursor against the broadcast integer and request `GET /api/v1/sync/changes?since=<local_seq>` over standard HTTP to receive permission-filtered changes.

### 4.3 Multi-Client Engineering Strategy

#### Web Client (`apps/web` — TanStack Start)

- Consumes `packages/eden-client` (Elysia Eden Treaty) for end-to-end type safety without codegen.
- Uses `@tanstack/react-query` for SSR hydration and optimistic Kanban board drag-and-drop updates.
- Uses **TipTap** or **BlockNote** bound to `yjs` streaming binary update vectors to the Rust Sync Engine.

#### Mobile Client (`apps/mobile` — React Native + Expo)

- Shares `packages/eden-client` and `packages/shared` with the web app.
- Stores session Bearer tokens in `expo-secure-store`.
- Implements an **offline-first SQLite replica** using `op-sqlite`. On app foreground or WebSocket sequence tick, the mobile client pulls delta changes (`?since=<local_seq>`) and applies them in a single local SQLite transaction.

#### Native Desktop Client (`apps/desktop` — Rust + Rune)

- **Shared Native Core (`crates/workspace-core`):** Shares exact Rust structs, `yrs::Doc` CRDT merge logic, WebSocket client handlers, and a local `rusqlite` (**FTS5**) search cache with the backend.
- **GPU-Accelerated UI (`anomalyco/rune`):** Renders the desktop workspace natively on the GPU with custom text layout, spring animations, and multi-tab split panes without Electron/Chromium memory overhead.
- **Sandboxed Automation Scripting (`crates/rune-plugins`):** Embeds the `rune-rs` dynamic scripting VM so users can run custom `.rn` macros and workflow rules within bounded memory/instruction limits.

---

## 5. Database Schema Blueprint (PostgreSQL 17)

Save this baseline migration in `packages/db/migrations/0001_init.sql`:

```sql
-- Required extensions for hierarchical doc trees and vector search
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Workspaces & RBAC Memberships
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role_mask BIGINT NOT NULL DEFAULT 1, -- Bitmask for granular permissions
    PRIMARY KEY (workspace_id, user_id)
);

-- 2. High-Water Sequence Log (Drives 1-second coalesced WebSocket sync)
CREATE TABLE workspace_events (
    seq BIGSERIAL PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, -- 'task', 'doc', 'chat_msg', 'mail_thread'
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,      -- 'created', 'updated', 'deleted'
    actor_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workspace_events_ws_seq ON workspace_events (workspace_id, seq);

-- 3. Tasks (Supports sub-issues, custom workflows, and fractional Kanban ordering)
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    identifier TEXT NOT NULL,           -- e.g., 'ENG-142'
    title TEXT NOT NULL,
    status_id UUID NOT NULL,
    priority SMALLINT NOT NULL DEFAULT 0,
    position DOUBLE PRECISION NOT NULL, -- Fractional indexing for O(1) row updates on drag
    crdt_state BYTEA,                   -- Compacted Yjs/yrs binary state for live description editing
    search_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title)) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, identifier)
);
CREATE INDEX idx_tasks_search ON tasks USING GIN (search_tsv);

-- 4. Docs (Hierarchical page tree using PostgreSQL ltree)
CREATE TABLE doc_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    tree_path LTREE NOT NULL,           -- e.g., 'root.eng_specs.api_v2'
    title TEXT NOT NULL,
    crdt_state BYTEA NOT NULL,          -- Yjs/yrs binary document snapshot
    plain_text TEXT NOT NULL DEFAULT '',
    embedding VECTOR(1536),             -- Semantic embedding for MCP AI retrieval
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_doc_pages_tree ON doc_pages USING GIST (tree_path);

-- 5. Chat Channels & Messages
CREATE TABLE chat_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_private BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    thread_parent_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
    author_id UUID NOT NULL,
    body_markdown TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Shared Inbox Links (Maps Stalwart JMAP threadId to internal Tasks/Docs)
CREATE TABLE mail_thread_links (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    jmap_thread_id TEXT NOT NULL,
    linked_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    linked_doc_id UUID REFERENCES doc_pages(id) ON DELETE CASCADE,
    PRIMARY KEY (workspace_id, jmap_thread_id, linked_task_id)
);
```

---

## 6. Internal gRPC Contract & Transactional API Pattern

### 6.1 Protocol Buffer Definition (`packages/proto/sync.proto`)

```protobuf
syntax = "proto3";
package workspace.sync.v1;

service SyncEngine {
  // Triggered by ElysiaJS whenever a transaction commits a new workspace_events row
  rpc NotifySequenceAdvance (SequenceAdvanceRequest) returns (Ack);

  // Used by ElysiaJS or MCP tools to read or mutate a live CRDT document
  rpc ApplyDocOperation (DocOperationRequest) returns (DocSnapshotResponse);
}

message SequenceAdvanceRequest {
  string workspace_id = 1;
  int64 high_water_seq = 2;
}

message DocOperationRequest {
  string workspace_id = 1;
  string doc_id = 2;
  bytes yrs_update_v1 = 3; // Binary Yjs update vector
}

message DocSnapshotResponse {
  bytes compacted_state = 1;
  string extracted_plain_text = 2;
}

message Ack {
  bool ok = 1;
}
```

### 6.2 ElysiaJS Transactional Mutation Handler (`apps/api/src/modules/tasks/index.ts`)

```typescript
import { Elysia, t } from 'elysia'
import { db } from '@workspace/db'
import { syncGrpcClient } from '../../grpc/client'

export const tasksController = new Elysia({ prefix: '/api/v1/tasks' }).patch(
	'/:taskId/move',
	async ({ params, body, user }) => {
		const result = await db.transaction(async (tx) => {
			// 1. Update task status and fractional Kanban position ($O(1)$ single-row update)
			const [updatedTask] = await tx`
          UPDATE tasks
          SET status_id = ${body.statusId},
              position = ${body.position},
              updated_at = now()
          WHERE id = ${params.taskId} AND workspace_id = ${body.workspaceId}
          RETURNING id, workspace_id, status_id, position, updated_at
        `

			// 2. Append to the high-water sequence log in the SAME transaction
			const [event] = await tx`
          INSERT INTO workspace_events (workspace_id, entity_type, entity_id, action, actor_id)
          VALUES (${body.workspaceId}, 'task', ${params.taskId}, 'updated', ${user.id})
          RETURNING seq
        `

			return { updatedTask, seq: Number(event.seq) }
		})

		// 3. Notify Rust Sync Engine over gRPC for 1-second coalesced broadcast
		syncGrpcClient.notifySequenceAdvance({
			workspaceId: body.workspaceId,
			highWaterSeq: result.seq
		})

		return result
	},
	{
		body: t.Object({
			workspaceId: t.String({ format: 'uuid' }),
			statusId: t.String({ format: 'uuid' }),
			position: t.Number()
		})
	}
)
```

---

## 7. Single-Server Deployment Configuration (Dokploy)

Deploy the entire platform on a single **4 vCPU / 8 GB RAM NVMe VPS** using **Dokploy**. Internal database and gRPC traffic stays isolated on `workspace-internal`, while HTTP/WSS services attach to `dokploy-network` for automatic Let's Encrypt TLS termination via Traefik.

### `deploy/docker-compose.yml`

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks:
      - workspace-internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  sync-engine:
    build:
      context: ..
      dockerfile: crates/sync-engine/Dockerfile
    restart: always
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      GRPC_LISTEN_ADDR: 0.0.0.0:50051
      WS_LISTEN_ADDR: 0.0.0.0:8080
      APP_KEY: ${APP_KEY}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - workspace-internal
      - dokploy-network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=dokploy-network"
      - "traefik.http.routers.ws-sync.rule=Host(`sync.${DOMAIN}`)"
      - "traefik.http.routers.ws-sync.entrypoints=websecure"
      - "traefik.http.routers.ws-sync.tls.certresolver=letsencrypt"
      - "traefik.http.services.ws-sync.loadbalancer.server.port=8080"

  api:
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      SYNC_GRPC_URL: http://sync-engine:50051
      STALWART_JMAP_URL: http://stalwart:8080
      PUBLIC_WEB_ORIGIN: https://${DOMAIN}
      APP_KEY: ${APP_KEY}
    volumes:
      - attachments_data:/var/lib/workspace/attachments
    depends_on:
      postgres:
        condition: service_healthy
      sync-engine:
        condition: service_started
    networks:
      - workspace-internal
      - dokploy-network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=dokploy-network"
      - "traefik.http.routers.ws-api.rule=Host(`api.${DOMAIN}`)"
      - "traefik.http.routers.ws-api.entrypoints=websecure"
      - "traefik.http.routers.ws-api.tls.certresolver=letsencrypt"
      - "traefik.http.services.ws-api.loadbalancer.server.port=3001"

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
    restart: always
    environment:
      NODE_ENV: production
      PUBLIC_API_URL: https://api.${DOMAIN}
      PUBLIC_WS_URL: wss://sync.${DOMAIN}
    depends_on:
      - api
    networks:
      - workspace-internal
      - dokploy-network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=dokploy-network"
      - "traefik.http.routers.ws-web.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.ws-web.entrypoints=websecure"
      - "traefik.http.routers.ws-web.tls.certresolver=letsencrypt"
      - "traefik.http.services.ws-web.loadbalancer.server.port=3000"

  stalwart:
    image: stalwartlabs/mail-server:latest
    restart: always
    ports:
      - "25:25"
      - "465:465"
      - "587:587"
      - "993:993"
    volumes:
      - stalwart_data:/opt/stalwart-mail
    networks:
      - workspace-internal
      - dokploy-network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=dokploy-network"
      - "traefik.http.routers.ws-mail.rule=Host(`mail.${DOMAIN}`)"
      - "traefik.http.routers.ws-mail.entrypoints=websecure"
      - "traefik.http.routers.ws-mail.tls.certresolver=letsencrypt"
      - "traefik.http.services.ws-mail.loadbalancer.server.port=8080"

volumes:
  pg_data:
  attachments_data:
  stalwart_data:

networks:
  workspace-internal:
    driver: bridge
  dokploy-network:
    external: true
```

---

## 8. Phased 16-Week Development Roadmap

### Phase 1: Monorepo Foundation, Dual-Auth & Dokploy CI/CD (Weeks 1–3)

- **Deliverables:**
  - Initialize Bun workspace (`apps/api`, `apps/web`, `apps/mobile`, `packages/*`) and Cargo workspace (`crates/*`, `apps/desktop`).
  - Configure `packages/proto` codegen for TypeScript and Rust (`tonic-build`).
  - Implement Dual-Auth in ElysiaJS: `__Host-` HTTP-only cookies for web browsers and scoped Bearer tokens for mobile and desktop clients.
  - Build the TanStack Start application shell (sidebar navigation, workspace switcher, `Ctrl+K` command modal).
  - Deploy the baseline stack to a single VPS via Dokploy with automated S3 PostgreSQL backups.
- **Acceptance Criteria:** `bun test` and `cargo test` pass in CI; fresh Dokploy deployment provisions TLS certificates for `${DOMAIN}`, `api.${DOMAIN}`, and `sync.${DOMAIN}`.

### Phase 2: Tasks Engine & High-Water Sequence Sync (Weeks 4–6)

- **Deliverables:**
  - Implement `tasks`, `workflow_statuses`, `task_relations`, and `workspace_events` tables.
  - Build the 1-second coalesced sequence broadcaster in `crates/sync-engine` and `/api/v1/sync/changes` delta endpoint in ElysiaJS.
  - Build List, Kanban Board (with fractional indexing), and Timeline views in TanStack Start.
  - Add two-way GitHub App webhook integration linking issues and pull requests to workspace tasks.
- **Acceptance Criteria:** Moving a task card on the Kanban board updates a second browser profile within 1 second without sending raw task payloads over the WebSocket.

### Phase 3: Collaborative Docs (`ltree` + `yrs` CRDT) & Hybrid Search (Weeks 7–9)

- **Deliverables:**
  - Build in-memory `yrs::Doc` room management in `crates/sync-engine` with live cursor awareness, 5-second debounced PostgreSQL snapshot flushing, and graceful `SIGTERM` state flushing.
  - Implement hierarchical page trees in PostgreSQL using `ltree`.
  - Integrate TipTap / BlockNote in `apps/web` connected to the Rust CRDT WebSocket endpoint.
  - Implement hybrid search (`tsvector` + `pgvector`) across tasks and documents for the `Ctrl+K` command palette.
- **Acceptance Criteria:** Two users can co-edit the same page simultaneously with live cursors, and container restarts preserve all uncommitted keystrokes via the `SIGTERM` flush handler.

### Phase 4: Real-Time Chat, Stalwart JMAP Inbox & MCP Server (Weeks 10–12)

- **Deliverables:**
  - Build `chat_channels` and `chat_messages` with thread support, file uploads, ephemeral typing indicators, and inline rich previews for task/doc links.
  - Integrate Stalwart Mail Server over JMAP (`http://stalwart:8080/jmap`) and build the `mail_thread_links` UI so customer emails appear alongside linked engineering tasks.
  - Build the OAuth 2.1 Model Context Protocol (`/mcp`) Streamable HTTP server in ElysiaJS exposing scoped workspace tools (`tasks.read`, `tasks.write`, `docs.search`, `mail.draft_reply`).
- **Acceptance Criteria:** Claude Desktop or Cursor can authenticate via OAuth 2.1 against `https://api.${DOMAIN}/mcp`, read linked customer email context, and create or update tasks.

### Phase 5: Mobile Application — React Native & Expo (Weeks 13–14)

- **Deliverables:**
  - Scaffold `apps/mobile` with Expo Router, `expo-secure-store`, and `packages/eden-client`.
  - Build the local `op-sqlite` offline cache and sequence cursor synchronizer.
  - Implement mobile task boards, chat channels, document reader/editor, and push notifications via Expo Push API / FCM.
- **Acceptance Criteria:** Mobile app loads cached tasks and chat messages instantaneously in airplane mode and reconciles delta changes automatically upon reconnecting.

### Phase 6: Native Desktop Client — Rust & Rune (Weeks 15–16)

- **Deliverables:**
  - Extract shared CRDT, WebSocket, and SQLite FTS5 caching logic into `crates/workspace-core`.
  - Build `apps/desktop` using **Rune** (`anomalyco/rune`) for GPU-accelerated split-pane layouts, native text rendering, and global OS quick-capture shortcuts (`Cmd/Ctrl + Shift + Space`).
  - Integrate `crates/rune-plugins` (`rune-rs`) for sandboxed local workflow automation scripts.
  - Configure GitHub Actions release pipelines for `.dmg` (macOS), `.msi` (Windows), and `.AppImage` (Linux).
- **Acceptance Criteria:** Desktop binary starts in under 150 ms, consumes under 60 MB of idle RAM, and syncs live `yrs` document changes directly with the server.
