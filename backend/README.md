# CaseMind – Backend Service

The `backend/` directory contains the Node.js, Express, and MongoDB service for CaseMind, an AI-assisted investigation workspace. This service is owned by **Member 1** and is responsible for data persistence, REST APIs, case scoping, and orchestration of the investigation analysis workflow.

---

## 1. Overview & Responsibilities

The backend is the authoritative owner of the database and investigation state:
- **MongoDB Ownership:** The backend owns all database connections, collections, indexes, and queries. Neither the AI module nor the frontend interacts directly with MongoDB.
- **Case Isolation:** Strictly scopes all evidence, memories, and reports by `caseId`.
- **Evidence Management:** Ingests immutable evidence items and assigns sequential case-scoped codes (`EV-01`, `EV-02`).
- **Working Memory Management:** Maintains cumulative investigative knowledge classified into facts, claims, contradictions, inferences, and hypotheses.
- **Immutable Report Versions:** Persists versioned synthesis reports (`v1`, `v2`, `v3`...) with compound unique index enforcement.
- **Analysis Orchestration:** Marshals case context, invokes the AI synthesis adapter, validates evidence citations and schema output, and safely commits reports and memory mutations.

---

## 2. Technology Stack

- **Runtime:** Node.js (CommonJS, `"type": "commonjs"`)
- **Web Framework:** Express.js (`^5.3.0`)
- **Database Driver:** MongoDB Node.js Driver (`^7.8.0`) — direct official driver without ORM overhead
- **Configuration:** Dotenv (`^18.0.9`)
- **Testing:** Node.js built-in `node:assert` and native global `fetch` (no external test runners or mock libraries required)

---

## 3. Prerequisites

- **Node.js:** Version **`18.0.0` or higher** is required (Node.js 18, 20, or 22 LTS recommended).
  - *Verification:* The project utilizes the `mongodb` v7.x driver (minimum requirement: Node 18+), native global `fetch`, and the `node:assert` module prefix in automated test suites.
- **Package Manager:** `npm` (bundled with Node.js)
- **MongoDB:** An accessible MongoDB 6.0+ instance (MongoDB Atlas connection URI or local MongoDB daemon).

---

## 4. Installation

From the repository root, navigate into the `backend/` directory and install dependencies:

```bash
cd backend
npm install
```

---

## 5. Environment Configuration

Create a `.env` file in the `backend/` directory based on the provided `.env.example`:

```bash
cp .env.example .env
```

### Configuration Variables

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | **Yes** | *None* | MongoDB connection string (e.g. `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority` or `mongodb://localhost:27017`) |
| `DB_NAME` | No | `casemind` | Target MongoDB database name |
| `PORT` | No | `5000` | Port for the Express HTTP server |
| `FRONTEND_ORIGIN` | No | *See below* | Comma-separated list of allowed origins for CORS (e.g. `http://localhost:3000,http://localhost:5173` or `*`). If unset in development, defaults to allowing `http://localhost:3000` and `http://localhost:5173`. |

> **Note on Secrets:** Never commit the `.env` file or database credentials to Git. `backend/.env` is included in `.gitignore`.

---

## 6. Running the Backend

### Start Server

```bash
npm start
```

On startup, the backend:
1. Connects to MongoDB Atlas using `MONGODB_URI`.
2. Automatically ensures required collection indexes exist.
3. Listens on `PORT` (default: `5000`).

### Verify Health

Verify server and database status via the unauthenticated health endpoint:

```bash
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected",
  "databaseName": "casemind",
  "uptime": 12
}
```

---

## 7. Automated Testing

The backend includes self-contained automated test suites utilizing ephemeral ports and isolated test documents. All tests automatically clean up their database records upon completion.

### Run All Core Suites
Runs the 4 primary entity API test suites in sequence:
```bash
npm test
```

### Run Analysis Orchestration Suite
Runs the 13 verification scenarios for analysis orchestration, AI schema validation, citation checks, and recovery:
```bash
npm run test:analysis
```

### Run Individual Test Suites
```bash
npm run test:evidence    # Evidence ingestion, code sequencing, timeline sorting
npm run test:memory      # Working memory queries and status filtering
npm run test:report      # Immutable report listing and version retrieval
```

---

## 8. REST API Summary

All endpoints return JSON wrapped in standard envelopes:
- **Success:** `{ "success": true, "data": ... }`
- **Error:** `{ "success": false, "error": { "code": string, "message": string, "details"?: object } }`

| Method | Endpoint | Description | Success Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Health probe and MongoDB ping check | `200 OK` |
| `POST` | `/api/cases` | Create a new investigation case (`title`, `description`) | `201 Created` |
| `GET` | `/api/cases` | List all investigation cases (newest first) | `200 OK` |
| `GET` | `/api/cases/:caseId` | Get single case details with aggregate statistics | `200 OK` |
| `POST` | `/api/cases/:caseId/evidence` | Ingest evidence; automatically allocates `EV-xx` code | `201 Created` |
| `GET` | `/api/cases/:caseId/evidence` | Retrieve all evidence sorted chronologically by `occurredAt` | `200 OK` |
| `GET` | `/api/cases/:caseId/memories` | Retrieve working memories (supports `?status=active\|resolved\|superseded\|all`) | `200 OK` |
| `GET` | `/api/cases/:caseId/reports` | List all synthesis report summaries (newest version first) | `200 OK` |
| `GET` | `/api/cases/:caseId/reports/:version` | Retrieve complete, immutable report payload by version number | `200 OK` |
| `POST` | `/api/cases/:caseId/analyze` | Trigger AI investigation synthesis pipeline | `201 Created` |

Refer to [`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) for complete payload schemas and error codes.

---

## 9. CORS Configuration

The backend implements configurable, zero-dependency CORS middleware in [`src/server.js`](src/server.js):
- **Development Defaults:** If `FRONTEND_ORIGIN` is not specified, `http://localhost:3000` (React/Next) and `http://localhost:5173` (Vite) are permitted.
- **Custom Whitelist:** Configure `FRONTEND_ORIGIN` in `.env` with a comma-separated list of allowed origins.
- **Preflight Support:** Responds to HTTP `OPTIONS` requests with `204 No Content`.
- **Allowed Methods:** `GET, POST, PUT, PATCH, DELETE, OPTIONS`.
- **Allowed Headers:** `Content-Type, Authorization`.
- **Stateless:** `Access-Control-Allow-Credentials` is disabled to reflect the tokenless/cookie-free hackathon architecture.

---

## 10. AI Adapter Boundary

The interface between the backend and the AI analysis logic is isolated in [`src/services/aiAdapter.js`](src/services/aiAdapter.js):

- **Direct In-Process Call:** Per [`PROJECT_RULES.md`](../PROJECT_RULES.md), the AI logic is an imported CommonJS module (`ai/`), not a separate microservice or HTTP server.
- **Zero Database Access in AI:** The backend fetches case-scoped evidence and memories, formats them into plain JavaScript objects matching `AnalyzeInvestigationInput`, and passes them to `analyzeInvestigation()`.
- **Separation of Integration:** Live AI integration is a distinct step managed by Member 2 (`ai/`). The backend adapter dynamically resolves the module when available.
- **Test Provider Injection:** The adapter provides `setAiProvider()` and `resetAiProvider()` functions, allowing the backend test suite to mock synthesis responses deterministically without making live Gemini API calls.

---

## 11. Core Architectural & Design Principles

1. **Strict Case Isolation:** Every database operation scopes by `caseId: ObjectId(...)`. Cross-case queries or citations are rejected with `404 CASE_NOT_FOUND` or `422 EVIDENCE_NOT_FOUND`.
2. **Immutable Evidence:** Evidence items are committed immediately upon ingestion and cannot be edited or deleted. Each item receives a persistent case-scoped sequence code (`EV-01`, `EV-02`...) backed by a unique compound index `{ caseId: 1, evidenceCode: 1 }`.
3. **Immutable, Versioned Reports:** Reports are strictly numbered (`version: 1, 2, 3...`) and protected against concurrent race conditions by a unique compound index on `{ caseId: 1, version: 1 }`.
4. **Citation Grounding Validation:** The backend scans every section of the AI output (`knownFacts`, `unverifiedClaims`, `evidenceConnections`, `contradictions`, `possibleHypotheses`, `memoryUpdates`) and verifies that all cited evidence codes exist in MongoDB for that case. Ungrounded citations result in rejection (`422 EVIDENCE_NOT_FOUND`) with zero database modifications.
5. **Epistemological Taxonomy:** Memories maintain a clear distinction between empirical facts (`fact`), unverified statements (`claim`), conflicting points (`contradiction`), logical deductions (`inference`), provisional working theories (`hypothesis`), and gaps (`open_question`).
6. **Resilient Persistence Strategy:** Uses MongoDB multi-document transactions when running on replica sets. When running on standalone instances, it uses an authoritative report-first pattern; if memory mutations fail thereafter, the report remains preserved as the immutable record and a structured `PARTIAL_WRITE_UNRECONCILED` error is returned.
