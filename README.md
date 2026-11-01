# 🧠 UPSC Brain Map

A full-stack app for UPSC preparation that keeps you anchored to the syllabus. Build a
**brain-map tree** of topics, attach **screenshots of personal notes**, extract their text
with an **AI vision model**, and **search** everything instantly with Elasticsearch.

## Features

- **Canvas home** — "Create a blank Canvas" + list of existing canvases.
- **Brain-map tree** — add child / sibling / root topics, drag to rearrange, and draw
  *logical cross-links* between any two topics.
- **Zoom-based progressive disclosure** — zoom out and only parent topics remain visible;
  zoom in and children gradually fade in (depth-aware level of detail).
- **Personal note screenshots** — attach images to any topic, run AI vision (OpenAI-compatible)
  or local OCR to extract text, then **leave it as text**, **append it as text**, or
  **append it to the brain map** (auto-parses headings/bullets into child nodes).
- **Elasticsearch full-text search** — search topic titles, content, and extracted note text
  with highlighted results and click-to-focus navigation.
- **Cross-canvas links** — link any existing canvas into another canvas as a topic node, then
  double-click the node (or use the editor's **Open** button) to jump across canvases.
- **AI Q&A on topics** — ask DeepSeek a question about any topic; the prompt automatically
  includes that topic's text plus its parent topics as context.
- **AI map builder** — type a request in a chat box and DeepSeek generates/populates a whole
  brain-map subtree for you.

## Architecture & database choices

| Concern | Technology | Why |
|---|---|---|
| Tree/graph source of truth | **PostgreSQL** | Relational integrity, recursive CTEs for depth & subtree queries, JSONB metadata |
| Full-text search | **Elasticsearch** | Relevance ranking, highlighting, scales beyond `ILIKE` |
| Binary screenshots | **Local disk** (MinIO optional) | Screenshots persist to `backend/storage/`; MinIO/S3 available as an optional backend |
| Vision / OCR | OpenAI-compatible API + **tesseract.js** | Best-effort AI extraction, graceful OCR fallback |
| UI | **React + React Flow** | Native canvas pan/zoom, custom nodes, minimap |
| API | **Node.js + Express** | Lightweight REST layer |

Elasticsearch is a *derived* index: Postgres remains the source of truth and every
node/attachment change re-indexes the affected document via `services/indexer.js`.
If Elasticsearch is ever down, search transparently falls back to Postgres `ILIKE`.

## Project layout

```
backend/   Express API (Postgres, Elasticsearch, MinIO, AI/OCR)
frontend/  React + Vite + React Flow UI
docker-compose.yml  Postgres + Elasticsearch + MinIO
```

## Prerequisites

- Node.js 16+ (Node 18+ recommended)
- Docker + Docker Compose

## Quick start

### 1. Start the databases

```bash
docker compose up -d
```

This starts PostgreSQL (5432) and Elasticsearch (9200). Screenshots are stored on local
disk by default — see the note about MinIO below.

### 2. Start the backend

```bash
cd backend
npm install
npm start
```

The API runs at `http://localhost:4000`. The schema is created automatically on startup.

> **AI vision model (optional):** copy `.env.example` to `backend/.env` and set
> `OPENAI_API_KEY`. If unset, text extraction falls back to local OCR (tesseract.js).
> `OPENAI_BASE_URL` + `OPENAI_MODEL` let you point at any OpenAI-compatible endpoint.

> **DeepSeek (AI Q&A + AI map builder):** set `DEEPSEEK_API_KEY` in `backend/.env`. The app
> uses `deepseek-chat` by default (configurable via `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL`).

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — create a canvas and start mapping the syllabus.

## Using it

1. **Create a canvas** (e.g. "Polity").
2. Select the root node and click **＋ Child** to grow the tree; **＋ Sibling** to branch;
   **＋ Root** for a second central topic.
3. **Drag from a node's right handle to another node's left handle** to draw a logical
   connection (dashed purple line).
4. **Zoom** with the mouse wheel / controls to watch parents stay and children fade in/out.
5. Click a node → **Attach screenshot** → **✨ Extract text** → choose
   **Leave as text**, **Append as text**, or **Append to brain map**.
6. Use **🔍 Search** to find any topic or note text (Elasticsearch), then click a result
   to fly to that node.
7. **🔗 Link canvas** — add another canvas as a topic node; double-click it (or use the editor's
   **Open** button) to jump to that canvas.
8. **🤖 AI** — open the chat panel, describe the map you want, and DeepSeek generates a subtree
   (under the selected node, or as a new central topic).
9. Select a topic and use **Ask AI** in the editor to ask a question; context = that topic's
   text plus its parent topics.

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/canvases` | list / create canvases |
| GET/PUT/DELETE | `/api/canvases/:id` | canvas detail / rename / delete |
| POST | `/api/canvases/:id/nodes` | create node |
| POST | `/api/canvases/:id/edges` | create cross-link |
| GET/PUT/DELETE | `/api/nodes/:id` | node detail / update / delete (subtree) |
| GET/POST | `/api/nodes/:id/attachments` | list / upload screenshot |
| GET | `/api/attachments/:id/file` | stream image |
| POST | `/api/attachments/:id/extract` | vision/OCR extraction |
| POST | `/api/attachments/:id/apply` | `store` / `append_text` / `append_nodes` |
| GET | `/api/search?q=&canvas_id=` | Elasticsearch search |
| POST | `/api/canvases/:id/link` | link another canvas as a topic node |
| POST | `/api/ai/ask` | AI Q&A on a node (context = node + ancestors) |
| POST | `/api/ai/build` | generate a brain-map tree from a prompt |

## Notes

- Elasticsearch 8 is configured single-node with security disabled for local use.
- Screenshots are stored on local disk by default (`STORAGE_BACKEND=local`, under `backend/storage/`).
- To use MinIO instead, run `docker compose --profile minio up -d` once your network allows
  pulling the MinIO image, then set `STORAGE_BACKEND=minio` in `backend/.env`.
