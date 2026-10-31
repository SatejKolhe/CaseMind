# CaseMind

**AI-Assisted Investigation Workspace with Persistent, Evidence-Linked Memory**

[![Node.js](https://img.shields.io/badge/Node.js-%5E20.19.0%20%7C%7C%20%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.3-blue.svg)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-19.3-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646cff.svg)](https://vitejs.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.8%20Native-47A248.svg)](https://www.mongodb.com/)
[![Zod](https://img.shields.io/badge/Zod-4.6-3E67B1.svg)](https://zod.dev/)

---

## 1. Overview & Problem Statement

### The Problem
Traditional conversational AI systems and naive Retrieval-Augmented Generation (RAG) chatbots fall short in high-stakes investigative workflows:
- **Hallucinated Citations:** Large language models frequently cite non-existent evidence or conflate timelines when summarizing multiple documents.
- **Epistemic Flattening:** Generic assistants treat unverified witness hearsay, forensic telemetry, logical deductions, and provisional hypotheses with equal weight.
- **Context Drift & Amnesia:** As investigations expand, unstructured chat history overflows context windows. Crucial contradictions get buried, and the AI cannot track which earlier interpretations have been superseded.
- **Lack of Legal & Audit Traceability:** Traditional chat completions provide ephemeral outputs without versioning or immutable historical states.

### The CaseMind Solution
**CaseMind** is an investigative workspace designed to give human investigators an objective, structured factual posture over complex cases. Instead of an append-only chat log, CaseMind implements an **evolving epistemic state machine** backed by an immutable database:
1. **Database Citation Verification:** The backend verifies every evidence code cited in AI synthesis reports against MongoDB records before persisting. Hallucinated or non-existent citations are rejected with HTTP 422.
2. **Persistent Working Memory Ledger:** Distinguishes empirical facts, witness claims, inferences, and working hypotheses into tracked memory items that transition through explicit states (`active`, `disputed`, `superseded`, `resolved`).
3. **Immutable Versioned Reports:** Every synthesis run generates a permanent, numbered report version (`v1`, `v2`, `v3`...) detailing an executive summary, established facts, flagged contradictions, open questions, and exact memory deltas.
4. **Epistemic Humility & Ethical Guardrails:** Code-level schema inspection enforces that the AI never adjudicates guilt, names suspects, or recommends punitive action, strictly serving as an objective analytical assistant.

---

## 2. Key Features Implemented

- **Case Management & Scoping:** Complete workspace isolation where all evidence, working memories, and reports are strictly scoped to a unique `caseId`.
- **Atomic Evidence Ingestion:** Sequential, auto-incrementing evidence codes (`EV-01`, `EV-02`...) allocated via atomic MongoDB `$inc` operations with unique compound index collision protection.
- **Structured AI Synthesis Pipeline:** Full synthesis orchestration evaluating newly ingested evidence against prior evidence, active memories, and previous report versions.
- **Ethical AST Guardrail Filter:** Recursive Zod schema inspection (`guardrailRefinement`) prohibiting forbidden adjudication keys (`guilty`, `culprit`, `suspectidentified`).
- **Prompt Injection Defense:** Untrusted evidence text is encapsulated inside `<evidence id="...">` XML blocks with strict system prompts instructing the model to treat content strictly as data, never instructions.
- **Working Memory Inspector:** Interactive UI ledger displaying active, contradicted, and superseded claims with collapsible historical rationale (`changeReason`) and citation badges.
- **Side-by-Side Version Comparison:** Side-by-side comparative inspection between baseline and comparison report versions.
- **Dual Persistence Strategy:** Supports MongoDB multi-document ACID transactions on replica sets, with an authoritative report-first fallback and `PARTIAL_WRITE_UNRECONCILED` structured event logging for standalone instances.
- **Multi-Provider LLM Engine:** Native, zero-dependency HTTP client supporting Google Gemini and OpenAI with response schema enforcement, exponential backoff, and rate-limit handling.
- **Interactive Workspace Navigation:** Fast local inquiry over active evidence records and report summaries, with a dedicated "⚡ Analyze Case" workflow for complete multi-modal AI synthesis.

---

## 3. Technology Stack

### Frontend Application (`frontend/`)
- **Framework:** React 19 (`19.3.1`)
- **Routing:** React Router DOM 7 (`7.18.5`)
- **Build Tool & Dev Server:** Vite 8 (`8.3.5`)
- **Linting:** Oxlint (`1.89.0`)
- **Styling:** Custom responsive dark theme CSS (ChatGPT/Claude-inspired interface)

### Backend Service (`backend/`)
- **Runtime:** Node.js (CommonJS, Node 20.19+ / 22.12+)
- **Framework:** Express.js (`5.3.0`)
- **Database Driver:** MongoDB Node.js Driver (`7.8.0`) — official native driver without ORM overhead
- **Configuration:** Dotenv (`18.0.9`)
- **Testing:** Node.js native `node:assert` and global `fetch` test suites

### AI Synthesis Engine (`server/ai/`)
- **Runtime:** Native Node.js HTTP/HTTPS `fetch` (no heavy third-party SDK dependencies)
- **Validation:** Zod (`4.6.7`)
- **Supported Providers:**
  - Google Gemini (`gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash`) via `generateContent` with native `responseSchema`
  - OpenAI (`gpt-4o`, `gpt-4o-mini`) via `chat/completions` with native `json_schema` structured outputs

### Database (`MongoDB`)
- **Engine:** MongoDB 6.0+ (MongoDB Atlas or local daemon)
- **Collections:** `cases`, `evidence`, `reports`, `memories`

---

## 4. Architecture & Component Interaction

```
[ Browser Client (React 19 / Vite) ]
                │
                │ HTTP / REST (JSON API)
                ▼
  [ Express 5.3 Backend Server (:5000) ]
   ├── Configurable CORS Middleware
   ├── Request Validation & Case Scoping
   ├── Database Gatekeeper (Citation Checks)
   └── AI Adapter Service (src/services/aiAdapter.js)
                │                               │
                │ Native Driver (TCP 27017)     │ In-Process Module Call
                ▼                               ▼
     [ MongoDB Atlas Database ]      [ AI Synthesis Engine (server/ai) ]
        ├── cases                       ├── Prompt & XML Context Assembly
        ├── evidence                    ├── Native HTTPS Call (Gemini/OpenAI)
        ├── reports                     ├── Zod Output Schema Validation
        └── memories                    └── Ethical AST Guardrail Filter
```

### Module Integration Model (No Microservices)
Per project design rules, CaseMind avoids premature microservice overhead:
1. **Backend Owns All Data Persistence:** Neither the AI module nor the frontend connects directly to MongoDB. The backend executes all database queries, index creation, and transaction commits.
2. **AI Module is an In-Process Engine:** The AI logic lives in `server/ai/` and is dynamically loaded by `backend/src/services/aiAdapter.js`. The backend extracts case context, passes plain JavaScript objects to `analyze()`, and receives validated synthesis payloads.
3. **Frontend Communicates Exclusively via REST:** The React application communicates solely through `backend/src/server.js` REST routes wrapped in `frontend/src/api.js`.

---

## 5. Repository Structure

```text
CaseMind/
├── PROJECT_RULES.md              # Project rules, team roles, and hackathon playbook
├── SPEC.md                       # Product specification and behavioral requirements
├── README.md                     # Root project documentation
├── docs/
│   └── API_CONTRACT.md           # REST endpoint and MongoDB schema specifications
├── backend/                      # Express & MongoDB backend service
│   ├── .env.example              # Template for backend environment variables
│   ├── README.md                 # Dedicated backend documentation
│   ├── package.json              # Backend dependencies and test scripts
│   ├── src/
│   │   ├── server.js             # Express application entry point & CORS configuration
│   │   ├── config/
│   │   │   └── db.js             # MongoDB connection pool & compound index setup
│   │   ├── controllers/
│   │   │   ├── caseController.js       # Case creation, retrieval, and statistics
│   │   │   ├── evidenceController.js   # Evidence ingestion & EV-xx code sequencing
│   │   │   ├── memoryController.js     # Working memory queries & status filtering
│   │   │   ├── reportController.js     # Immutable report retrieval by version
│   │   │   └── analysisController.js   # AI analysis orchestration & citation validation
│   │   ├── routes/                     # Express REST route handlers
│   │   └── services/
│   │       └── aiAdapter.js      # Normalizer bridging backend contract & AI module
│   └── test/                     # Automated integration & unit test suites
├── server/ai/                    # In-process AI analysis engine
│   ├── .env.example              # Template for AI provider configuration
│   ├── package.json              # AI module dependencies (Zod)
│   ├── config.js                 # AI configuration loader & environment validator
│   ├── analyze.js                # Core prompt builder & analysis pipeline entry point
│   ├── llm.js                    # Native fetch dispatcher (Gemini & OpenAI) with retries
│   ├── schemas.js                # Zod schemas & ethical guardrail AST validation
│   └── prompts/
│       └── system.js             # System prompt with epistemic rules & anti-injection
└── frontend/                     # React 19 single-page application
    ├── .env.example              # Template for frontend environment variables
    ├── package.json              # Frontend scripts and UI dependencies
    ├── vite.config.js            # Vite configuration
    ├── index.html                # HTML document entry point
    └── src/
        ├── main.jsx              # React DOM initialization
        ├── App.jsx               # Application shell, routing, and auth state
        ├── api.js                # Strongly-typed fetch API client & error mapper
        ├── styles.css            # Dark theme design system
        └── components/
            ├── Sidebar.jsx           # Case navigator & project switcher
            ├── ChatWorkspace.jsx     # Active case briefing & analysis command bar
            ├── EvidenceModal.jsx     # Evidence ledger modal container
            ├── EvidenceSection.jsx   # Evidence submission form & chronological table
            ├── MemoryModal.jsx       # Working memory modal container
            ├── MemoryInspector.jsx   # Working memory table with state badges
            ├── ReportModal.jsx       # Side-by-side report version comparison modal
            ├── ReportView.jsx        # Structured report renderer (8 sections)
            └── GoogleAuthModal.jsx   # Client-side investigator identity switcher
```

---

## 6. Environment Variables

Create `.env` files in `backend/`, `server/ai/`, and `frontend/` based on their respective `.env.example` templates.

### Backend (`backend/.env`)
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | **Yes** | *None* | MongoDB connection URI (`mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority` or `mongodb://localhost:27017`) |
| `DB_NAME` | No | `casemind` | MongoDB target database name |
| `PORT` | No | `5000` | HTTP port for the Express backend server |
| `FRONTEND_ORIGIN` | No | `http://localhost:3000,http://localhost:5173` | Comma-separated list of allowed CORS origins or `*` |

### AI Engine (`server/ai/.env` or shared in `backend/.env`)
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `AI_PROVIDER` | **Yes** | `gemini` | Target LLM provider (`gemini` or `openai`) |
| `AI_API_KEY` | **Yes** | *None* | API key for Gemini or OpenAI (never commit secrets) |
| `AI_MODEL` | **Yes** | `gemini-1.5-flash` | Model identifier (e.g. `gemini-1.5-flash`, `gemini-1.5-pro`, `gpt-4o`, `gpt-4o-mini`) |
| `AI_TIMEOUT_MS` | No | `60000` | Per-call timeout in milliseconds before aborting |
| `AI_MAX_RETRIES` | No | `2` | Maximum retry attempts on 429 rate limits or 5xx server errors |
| `CONTEXT_TOKEN_BUDGET` | No | `6000` | Maximum token budget for injected evidence context |
| `USE_LLM_REDACTION` | No | `false` | Enable LLM-based redaction vs regex rule redaction |

### Frontend (`frontend/.env`)
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `VITE_API_URL` | No | `http://localhost:5000/api` | Base URL of the CaseMind backend REST API |
| `VITE_USE_MOCK` | No | `false` | Set to `true` to run purely on local mock fixtures |

---

## 7. Setup & Local Installation

### Prerequisites
- **Node.js:** Version **`^20.19.0 || >=22.12.0`** (Node.js 20.19+ or 22.12+ LTS)
  - *Verification:* Enforced by Vite 8 (`frontend/node_modules/vite/package.json` engines requirement).
- **npm:** Package manager bundled with Node.js
- **MongoDB:** Accessible MongoDB Atlas instance or local MongoDB daemon

### 1. Clone the Repository
```bash
git clone https://github.com/SatejKolhe/CaseMind.git
cd CaseMind
```

### 2. Install Dependencies
Install dependencies across workspace packages:
```bash
# Install backend dependencies
cd backend
npm install
cd ..

# Install AI module dependencies
cd server/ai
npm install
cd ../..

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 3. Configure Environment
Set up backend configuration:
```bash
cp backend/.env.example backend/.env
```
Edit `backend/.env` and supply your `MONGODB_URI`, `AI_PROVIDER`, `AI_API_KEY`, and `AI_MODEL`.

Set up frontend configuration:
```bash
cp frontend/.env.example frontend/.env
```

---

## 8. Running the Application Locally

### Start the Backend Server
```bash
cd backend
npm start
```
The server will initialize MongoDB indexes and listen on `http://localhost:5000`.

**Verify Server Health:**
```bash
curl http://localhost:5000/health
```
Expected output:
```json
{
  "status": "ok",
  "database": "connected",
  "databaseName": "casemind",
  "uptime": 5
}
```

### Run Automated Backend Tests
CaseMind includes automated, self-cleaning test suites using isolated test documents:
```bash
cd backend

# Run core entity API test suites (case, evidence, memory, report)
npm test

# Run analysis orchestration & citation verification tests
npm run test:analysis
```

### Start the Frontend Client
In a separate terminal window:
```bash
cd frontend
npm run dev
```
Open your browser at `http://localhost:5173`.

---

## 9. REST API Reference

All responses follow standard JSON envelopes:
- **Success:** `{ "success": true, "data": ... }`
- **Error:** `{ "success": false, "error": { "code": string, "message": string, "details"?: object } }`

| Method | Endpoint | Description | Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Server status and active database ping | `200 OK` |
| `POST` | `/api/cases` | Create a new investigation case | `201 Created` |
| `GET` | `/api/cases` | List all cases (ordered newest first) | `200 OK` |
| `GET` | `/api/cases/:caseId` | Retrieve single case metadata and entity statistics | `200 OK` |
| `POST` | `/api/cases/:caseId/evidence` | Ingest evidence; automatically allocates `EV-xx` code | `201 Created` |
| `GET` | `/api/cases/:caseId/evidence` | List all evidence sorted chronologically by `occurredAt` | `200 OK` |
| `GET` | `/api/cases/:caseId/memories` | Retrieve working memories (supports `?status=active\|resolved\|superseded\|all`) | `200 OK` |
| `GET` | `/api/cases/:caseId/reports` | List all report summaries ordered by version descending | `200 OK` |
| `GET` | `/api/cases/:caseId/reports/:version` | Retrieve complete, immutable report document by version number | `200 OK` |
| `POST` | `/api/cases/:caseId/analyze` | Trigger AI synthesis, validate citations, and commit report version | `201 Created` |

### Key API Examples *(Illustrative)*

#### 1. Ingest Evidence (`POST /api/cases/:caseId/evidence`)
**Illustrative Request Body:**
```json
{
  "title": "Display Pedestal Pressure Sensor Log",
  "content": "Load cell sensor registered sudden drop from 15.2kg to 0kg at 21:42:10.",
  "source": "Gallery Telemetry Server #81",
  "sourceType": "digital",
  "verificationStatus": "verified",
  "occurredAt": "2026-10-30T21:42:10.000Z"
}
```
**Illustrative Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "_id": "67232e02a1b2c3d4e5f60010",
    "caseId": "67232e01a1b2c3d4e5f60001",
    "evidenceCode": "EV-01",
    "title": "Display Pedestal Pressure Sensor Log",
    "content": "Load cell sensor registered sudden drop from 15.2kg to 0kg at 21:42:10.",
    "source": "Gallery Telemetry Server #81",
    "sourceType": "digital",
    "verificationStatus": "verified",
    "occurredAt": "2026-10-30T21:42:10.000Z",
    "createdAt": "2026-10-31T02:10:00.000Z"
  }
}
```

#### 2. Trigger AI Analysis (`POST /api/cases/:caseId/analyze`)
**Illustrative Request Body (Optional):**
```json
{
  "triggerEvidenceCode": "EV-03"
}
```
**Illustrative Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "reportId": "67232e04a1b2c3d4e5f60031",
    "caseId": "67232e01a1b2c3d4e5f60001",
    "version": 2,
    "summary": "Timeline conflict identified between display sensor telemetry (21:42) and witness sighting (21:55). Confounding electrical surge recorded at 21:42.",
    "knownFacts": [
      {
        "statement": "Display pedestal pressure sensor registered load drop at 21:42:10.",
        "evidenceCodes": ["EV-01"]
      }
    ],
    "unverifiedClaims": [
      {
        "statement": "Server Clara Bell observed statue present on pedestal at 21:55.",
        "source": "Witness Interview #1",
        "evidenceCodes": ["EV-02"]
      }
    ],
    "contradictions": [
      {
        "pointOfConflict": "Conflict: Sensor zero-reading at 21:42 vs. witness observation at 21:55.",
        "conflictingEvidenceCodes": ["EV-01", "EV-02"]
      }
    ],
    "possibleHypotheses": [
      {
        "hypothesisId": "H-1",
        "title": "Theft at 21:42 (Witness Mistaken)",
        "rationale": "Sensor telemetry is objective and verified.",
        "supportedBy": ["EV-01"],
        "status": "under_consideration"
      }
    ],
    "openQuestions": [
      "Did any other guests observe the pedestal between 21:42 and 21:55?"
    ],
    "suggestedNextChecks": [
      "Audit server room electrical and breaker reset logs for 21:40-22:00."
    ],
    "memoryDelta": {
      "added": [
        "Fact: Electrical surge logged at 21:42 (EV-03)."
      ],
      "updated": [
        "Hypothesis H-1 updated to reflect power surge factor."
      ],
      "explanation": "Ingested EV-03; identified electrical surge as alternative explanation for telemetry drop."
    },
    "triggerEvidenceCode": "EV-03",
    "createdAt": "2026-10-31T02:18:00.000Z"
  }
}
```

---

## 10. Deployment Guide

### Frontend on Vercel
1. Connect your GitHub repository to [Vercel](https://vercel.com/).
2. Select the repository and configure the project settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add Environment Variable:
   - `VITE_API_URL`: The public URL of your deployed backend (e.g. `https://casemind-backend.onrender.com/api`).
4. Click **Deploy**.

### Backend on Render
Because the backend imports the in-process AI engine from `server/ai/` (`path.resolve(__dirname, '../../../server/ai/analyze')`), Render must have access to the repository root:

1. Create a new **Web Service** on [Render](https://render.com/) pointing to the repository.
2. Configure service settings:
   - **Root Directory:** *(leave blank for repository root)*
   - **Environment:** `Node`
   - **Build Command:** `npm --prefix backend install && npm --prefix server/ai install`
   - **Start Command:** `node backend/src/server.js`
3. Configure Environment Variables in Render:
   - `MONGODB_URI`: Your MongoDB Atlas connection string.
   - `DB_NAME`: `casemind`
   - `PORT`: `5000` (or leave default, Render sets `PORT` automatically).
   - `FRONTEND_ORIGIN`: Your deployed Vercel domain (e.g. `https://casemind.vercel.app`).
   - `AI_PROVIDER`: `gemini` (or `openai`)
   - `AI_API_KEY`: Your production API key.
   - `AI_MODEL`: `gemini-1.5-flash` (or `gpt-4o-mini`)
4. Click **Create Web Service**.

---

## 11. Team & Contributors

CaseMind was built and integrated according to [`PROJECT_RULES.md`](PROJECT_RULES.md) by:

- **Satej Kolhe** ([@SatejKolhe](https://github.com/SatejKolhe)) — **Member 1 (Backend & Persistence)**<br />
  *Responsibilities:* Backend application, server setup, MongoDB schemas and persistence, REST APIs, case/evidence endpoints, citation validation gatekeeper, and report-version storage.
- **Dhruv** — **Member 2 (AI Synthesis & Memory Engine)**<br />
  *Responsibilities:* AI and memory module (`server/ai/`), AI analysis pipelines, structured JSON output enforcement, evidence-reference validation logic, and agentic-memory logic.
- **Chintan Makwana** — **Member 3 (Frontend & User Experience)**<br />
  *Responsibilities:* Frontend application, user interface, API integration, interactive memory inspector, report history view, and end-to-end user journey verification.
