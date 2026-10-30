# CaseMind – API & Data Contract

> **STATUS: PROPOSED CONTRACT (Team Review Required)**  
> **Target Audience:** All 3 Team Members & AI Assistants  
> **Scope:** Hackathon MVP (Core End-to-End Workflow)  
> **Mandatory Rule:** Once approved by Member 1, Member 2, and Member 3, no field names, endpoints, or response shapes may change without explicit team consensus.

---

## 1. Overview & Core Architectural Principles

CaseMind enables investigative teams to ingest fictional evidence, maintain a persistent working memory, run AI-assisted synthesis, and produce auditable, immutable report versions.

### Core Principles
1. **Case-Scoped Isolation:** Every database read, write, and AI analysis prompt is strictly scoped by `caseId`. Cross-case leakage is prohibited.
2. **Standardized Identifiers:**
   * **Internally in MongoDB:** All document primary keys (`_id`) and relational foreign keys (`caseId`) use native BSON `ObjectId`.
   * **In REST JSON API:** All `ObjectId` instances are serialized to standard 24-character hexadecimal strings (e.g., `"67232e01a1b2c3d4e5f60001"`).
   * **Human Citations:** Evidence items carry a human-readable, case-scoped code (e.g. `EV-01`, `EV-02`) used in investigator notes and AI citations.
3. **Temporal Distinction (Event Time vs. Record Time):**
   * `occurredAt`: The timestamp when the real-world event or observation occurred (e.g., sensor trigger time, witness sighting time).
   * `createdAt`: The timestamp when the investigator created/persisted the record in CaseMind.
4. **Evidence Provenance & Immutability:** Evidence items are immutable once created. They record source, ingested timestamp, event timestamp, and initial verification status.
5. **Rigorous Working Memory Taxonomy:** Working memory explicitly distinguishes:
   * **Facts (`fact`):** Direct, verified empirical observations (e.g., sensor telemetry, official records).
   * **Claims (`claim`):** Unverified assertions from witnesses, suspects, or unofficial sources.
   * **Contradictions (`contradiction`):** Direct irreconcilable conflicts between two or more evidence items or claims.
   * **Inferences (`inference`):** Logical deductions drawn from combining multiple facts or corroborating claims.
   * **Hypotheses (`hypothesis`):** Working investigative theories explaining the broader situation. Always marked provisional with unresolved points.
   * **Open Questions (`open_question`):** Critical investigative gaps or missing intelligence.
6. **No Guilt Determinations:** The system is an investigative aid for human decision-makers. Hypotheses must never be stated as established facts, and the system strictly prohibits claiming legal guilt or innocence.
7. **Safe Concurrency & Immutable Report Versions:** Reports are strictly versioned (`version: 1, 2, 3...`) and immutable. A compound unique index on `{ caseId: 1, version: 1 }` prevents version duplication.
8. **Decoupled Architecture & Safe Persistence:**
   * The `ai/` module is a standalone code module (not a microservice) with zero direct database access.
   * The `backend/` application owns all database access, case-scoped context retrieval, evidence citation verification against MongoDB, and persistence.
   * Submitted evidence is committed to MongoDB immediately upon receipt. If AI analysis or report persistence later fails, the evidence is preserved and prior report versions remain untouched.

---

## 2. Standard Error Format & HTTP Status Codes

All API endpoints return JSON. In the event of an error, the response body always follows this standard envelope:

```json
{
  "success": false,
  "error": {
    "code": "EVIDENCE_NOT_FOUND",
    "message": "One or more cited evidence codes do not exist for this case.",
    "details": {
      "invalidEvidenceCodes": ["EV-999"]
    }
  }
}
```

### Standard HTTP Status Codes
* `200 OK`: Request succeeded (retrieval or query).
* `201 Created`: Resource successfully created (Case, Evidence, Report).
* `400 Bad Request`: Missing required fields, invalid JSON, or malformed ID format.
* `404 Not Found`: Case, Evidence, or Report not found for the given `caseId`.
* `409 Conflict`: Concurrency conflict (e.g., duplicate report version attempt during simultaneous analysis runs).
* `422 Unprocessable Entity`: Semantic failure (e.g., AI returned invalid citations or ungrounded assertions).
* `500 Internal Server Error`: Unhandled server or database error.
* `502 Bad Gateway`: External LLM API timeout, failure, or unparseable output.

---

## 3. MongoDB Document Schemas & Indexes

All collections reside in the `casemind` database.

### 3.1 Collection: `cases`
Stores case metadata and status.

**Indexes:**
* `{ _id: 1 }` (Primary)

```typescript
// Mongoose / TypeScript Interface
interface CaseDocument {
  _id: ObjectId;             // BSON ObjectId (serialized as 24-char hex string in API)
  title: string;             // Human-readable title
  description: string;       // Case briefing / scope
  status: "open" | "closed"; // Case state
  createdAt: Date;           // ISODate
  updatedAt: Date;           // ISODate
}
```

*Example MongoDB Document (`cases`):*
```json
{
  "_id": { "$oid": "67232e01a1b2c3d4e5f60001" },
  "title": "The Obsidian Gallery Heist",
  "description": "Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala.",
  "status": "open",
  "createdAt": { "$date": "2026-10-31T02:00:00.000Z" },
  "updatedAt": { "$date": "2026-10-31T02:00:00.000Z" }
}
```

---

### 3.2 Collection: `evidence`
Stores immutable pieces of submitted evidence for a case.

**Indexes:**
* `{ _id: 1 }` (Primary)
* `{ caseId: 1, evidenceCode: 1 }` (Unique compound index)
* `{ caseId: 1, occurredAt: 1 }` (Chronological timeline lookup)

```typescript
interface EvidenceDocument {
  _id: ObjectId;                       // BSON ObjectId
  caseId: ObjectId;                    // Foreign key -> cases._id
  evidenceCode: string;                // Short readable code unique per case: "EV-01", "EV-02"
  title: string;                       // Short summary
  content: string;                     // Detailed narrative or extracted text
  source: string;                      // e.g. "Gallery Telemetry Server Log #81", "Server Clara Bell interview"
  sourceType: "witness" | "physical" | "digital" | "document" | "cctv";
  verificationStatus: "verified" | "unverified" | "disputed";
  occurredAt: Date;                    // Time when the event/observation actually happened
  createdAt: Date;                     // Time when evidence was ingested into CaseMind
}
```

*Example MongoDB Document (`evidence`):*
```json
{
  "_id": { "$oid": "67232e02a1b2c3d4e5f60010" },
  "caseId": { "$oid": "67232e01a1b2c3d4e5f60001" },
  "evidenceCode": "EV-01",
  "title": "Display Case Tamper Sensor Log",
  "content": "Glass case pressure sensor dropped from 15.2kg to 0kg at 21:42:10.",
  "source": "Gallery Telemetry Server Log #81",
  "sourceType": "digital",
  "verificationStatus": "verified",
  "occurredAt": { "$date": "2026-10-30T21:42:10.000Z" },
  "createdAt": { "$date": "2026-10-31T02:05:00.000Z" }
}
```

---

### 3.3 Collection: `memories`
Stores the active knowledge items and cumulative case memory. Every memory item is categorized according to our epistemological taxonomy.

**Indexes:**
* `{ _id: 1 }` (Primary)
* `{ caseId: 1, status: 1 }` (Active working memory lookup)

```typescript
interface MemoryDocument {
  _id: ObjectId;                       // BSON ObjectId
  caseId: ObjectId;                    // Foreign key -> cases._id
  category: "fact" | "claim" | "contradiction" | "inference" | "hypothesis" | "open_question";
  statement: string;                   // Concise summary of knowledge item
  supportingEvidenceCodes: string[];   // Valid cited codes (e.g. ["EV-01", "EV-02"])
  conflictingEvidenceCodes?: string[]; // For category === "contradiction"
  hypothesisDetails?: {                // For category === "hypothesis"
    hypothesisId: string;              // e.g. "H-1"
    title: string;
    rationale: string;
    unresolvedPoints: string[];
  };
  source?: string;                     // For category === "claim" (witness or source name)
  status: "active" | "resolved" | "superseded";
  lastUpdatedInVersion: number;        // Report version number that last touched this
  changeReason: string;                // Explanation of why this memory was created or modified
  createdAt: Date;                     // ISODate
  updatedAt: Date;                     // ISODate
}
```

*Example MongoDB Document (`memories`):*
```json
{
  "_id": { "$oid": "67232e03a1b2c3d4e5f60020" },
  "caseId": { "$oid": "67232e01a1b2c3d4e5f60001" },
  "category": "fact",
  "statement": "Display case pressure sensor recorded drop from 15.2kg to 0kg at 21:42:10.",
  "supportingEvidenceCodes": ["EV-01"],
  "status": "active",
  "lastUpdatedInVersion": 1,
  "changeReason": "Initialized from direct digital telemetry log EV-01.",
  "createdAt": { "$date": "2026-10-31T02:10:00.000Z" },
  "updatedAt": { "$date": "2026-10-31T02:10:00.000Z" }
}
```

---

### 3.4 Collection: `reports`
Stores immutable, versioned synthesis reports.

**Indexes:**
* `{ _id: 1 }` (Primary)
* `{ caseId: 1, version: 1 }` (**Unique compound index** — guarantees no duplicate version numbers under concurrent execution)

```typescript
interface ReportDocument {
  _id: ObjectId;                       // BSON ObjectId
  caseId: ObjectId;                    // Foreign key -> cases._id
  version: number;                     // 1, 2, 3...
  summary: string;                     // Executive summary of current case posture
  knownFacts: Array<{
    statement: string;
    evidenceCodes: string[];
  }>;
  unverifiedClaims: Array<{
    statement: string;
    source: string;
    evidenceCodes: string[];
  }>;
  evidenceConnections: Array<{
    connection: string;
    evidenceCodes: string[];
  }>;
  contradictions: Array<{
    pointOfConflict: string;
    conflictingEvidenceCodes: string[];
  }>;
  possibleHypotheses: Array<{
    hypothesisId: string;              // e.g. "H-1"
    title: string;
    rationale: string;
    supportedBy: string[];             // evidenceCodes
    unresolvedPoints: string[];
  }>;
  openQuestions: string[];
  suggestedNextChecks: string[];
  memoryDelta: {
    added: string[];                   // Statements added to memory
    updated: string[];                 // Statements modified in memory
    explanation: string;               // Summary of what changed in this version and why
  };
  triggerEvidenceCode?: string;        // Code that triggered this run (if applicable)
  createdAt: Date;                     // ISODate
}
```

---

## 4. REST API Endpoints Specification

Base URL: `/api`

### 4.1 Cases

#### `POST /api/cases`
Creates a new fictional investigation case.
* **Request Body:**
  ```json
  {
    "title": "The Obsidian Gallery Heist",
    "description": "Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala."
  }
  ```
  *Required fields:* `title` (string)
* **Response `201 Created`:**
  ```json
  {
    "success": true,
    "data": {
      "_id": "67232e01a1b2c3d4e5f60001",
      "title": "The Obsidian Gallery Heist",
      "description": "Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala.",
      "status": "open",
      "createdAt": "2026-10-31T02:00:00.000Z",
      "updatedAt": "2026-10-31T02:00:00.000Z"
    }
  }
  ```

#### `GET /api/cases`
Lists all cases.
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "67232e01a1b2c3d4e5f60001",
        "title": "The Obsidian Gallery Heist",
        "status": "open",
        "createdAt": "2026-10-31T02:00:00.000Z"
      }
    ]
  }
  ```

#### `GET /api/cases/:caseId`
Retrieves a single case by ID with counts of associated evidence, active memories, and latest report version.
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "_id": "67232e01a1b2c3d4e5f60001",
      "title": "The Obsidian Gallery Heist",
      "description": "Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala.",
      "status": "open",
      "stats": {
        "evidenceCount": 1,
        "activeMemoriesCount": 2,
        "latestReportVersion": 1
      },
      "createdAt": "2026-10-31T02:00:00.000Z",
      "updatedAt": "2026-10-31T02:10:00.000Z"
    }
  }
  ```

---

### 4.2 Evidence

#### `POST /api/cases/:caseId/evidence`
Submits a new piece of evidence scoped to the specified case. Generates an auto-incrementing `evidenceCode` (e.g. `EV-01`, `EV-02`) for easy citation.
* **Request Body:**
  ```json
  {
    "title": "Catering Staff Witness Statement",
    "content": "Server Clara Bell asserts the bronze statue was still present on the pedestal when she served drinks near it at 21:55.",
    "source": "Witness Interview #1 - Investigator Notes",
    "sourceType": "witness",
    "verificationStatus": "unverified",
    "occurredAt": "2026-10-30T21:55:00.000Z"
  }
  ```
  *Required fields:* `title`, `content`, `source`, `sourceType`, `verificationStatus`, `occurredAt`
  *Allowed `sourceType`:* `"witness" | "physical" | "digital" | "document" | "cctv"`
  *Allowed `verificationStatus`:* `"verified" | "unverified" | "disputed"`
* **Response `201 Created`:**
  ```json
  {
    "success": true,
    "data": {
      "_id": "67232e02a1b2c3d4e5f60011",
      "caseId": "67232e01a1b2c3d4e5f60001",
      "evidenceCode": "EV-02",
      "title": "Catering Staff Witness Statement",
      "content": "Server Clara Bell asserts the bronze statue was still present on the pedestal when she served drinks near it at 21:55.",
      "source": "Witness Interview #1 - Investigator Notes",
      "sourceType": "witness",
      "verificationStatus": "unverified",
      "occurredAt": "2026-10-30T21:55:00.000Z",
      "createdAt": "2026-10-31T02:15:00.000Z"
    }
  }
  ```

#### `GET /api/cases/:caseId/evidence`
Retrieves all evidence records scoped to the case, ordered by `occurredAt` ascending (chronological event order).
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "67232e02a1b2c3d4e5f60010",
        "caseId": "67232e01a1b2c3d4e5f60001",
        "evidenceCode": "EV-01",
        "title": "Display Case Tamper Sensor Log",
        "content": "Glass case pressure sensor dropped from 15.2kg to 0kg at 21:42:10.",
        "source": "Gallery Telemetry Server Log #81",
        "sourceType": "digital",
        "verificationStatus": "verified",
        "occurredAt": "2026-10-30T21:42:10.000Z",
        "createdAt": "2026-10-31T02:05:00.000Z"
      },
      {
        "_id": "67232e02a1b2c3d4e5f60011",
        "caseId": "67232e01a1b2c3d4e5f60001",
        "evidenceCode": "EV-02",
        "title": "Catering Staff Witness Statement",
        "content": "Server Clara Bell asserts the bronze statue was still present on the pedestal when she served drinks near it at 21:55.",
        "source": "Witness Interview #1 - Investigator Notes",
        "sourceType": "witness",
        "verificationStatus": "unverified",
        "occurredAt": "2026-10-30T21:55:00.000Z",
        "createdAt": "2026-10-31T02:15:00.000Z"
      }
    ]
  }
  ```

---

### 4.3 AI Analysis & Synthesis

#### `POST /api/cases/:caseId/analyze`
Triggers the AI synthesis pipeline.
1. `backend/` fetches all existing evidence and active memories for `caseId` from MongoDB.
2. `backend/` imports and invokes `analyzeInvestigation({ caseDetails, evidenceList, currentMemories })` from the `ai/` module.
3. `ai/` runs LLM synthesis and validates its own structured JSON schema before returning.
4. `backend/` checks all cited evidence codes against MongoDB records for `caseId`.
5. If validation passes, `backend/` persists the new report document (`version = latest + 1`) and updates the `memories` collection.
6. Returns the new report along with the memory delta.

* **Request Body (Optional parameters):**
  ```json
  {
    "triggerEvidenceCode": "EV-03"
  }
  ```
  *(If `triggerEvidenceCode` is omitted, analysis evaluates the full case corpus).*
* **Response `201 Created`:**
  ```json
  {
    "success": true,
    "data": {
      "reportId": "67232e04a1b2c3d4e5f60031",
      "caseId": "67232e01a1b2c3d4e5f60001",
      "version": 2,
      "summary": "Chronological conflict identified between display sensor telemetry (21:42) and witness sighting (21:55). Confounding electrical surge recorded at 21:42.",
      "knownFacts": [
        {
          "statement": "Display pedestal pressure sensor registered 15.2kg load drop to zero at 21:42:10.",
          "evidenceCodes": ["EV-01"]
        },
        {
          "statement": "Building electrical surge and circuit breaker reset occurred at 21:42:00.",
          "evidenceCodes": ["EV-03"]
        }
      ],
      "unverifiedClaims": [
        {
          "statement": "Server Clara Bell observed statue on pedestal at 21:55.",
          "source": "Catering Staff Witness Statement",
          "evidenceCodes": ["EV-02"]
        }
      ],
      "evidenceConnections": [
        {
          "connection": "The 13-minute gap between the sensor zero-reading at 21:42 and witness observation at 21:55 creates a direct timeline conflict. Concurrently, the electrical surge at 21:42 provides a potential alternative explanation for the telemetry drop.",
          "evidenceCodes": ["EV-01", "EV-02", "EV-03"]
        }
      ],
      "contradictions": [
        {
          "pointOfConflict": "Sensor telemetry indicates pedestal was empty at 21:42:10 (EV-01), whereas witness statement asserts statue remained in place at 21:55 (EV-02). Neither source is definitively ruled out.",
          "conflictingEvidenceCodes": ["EV-01", "EV-02"]
        }
      ],
      "possibleHypotheses": [
        {
          "hypothesisId": "H-1",
          "title": "Theft at 21:42 (Witness Mistaken)",
          "rationale": "Sensor telemetry is objective and verified; witness Clara Bell may have misremembered time or glanced at an empty case in dim gala lighting.",
          "supportedBy": ["EV-01"],
          "unresolvedPoints": ["Requires verification of witness reliability and gala lighting conditions."]
        },
        {
          "hypothesisId": "H-2",
          "title": "Electrical Surge / Sensor Anomaly (Theft After 21:55)",
          "rationale": "Building electrical surge at 21:42 may have caused a false telemetry drop on the pedestal, which is consistent with witness observing statue at 21:55. This explanation is strictly hypothetical.",
          "supportedBy": ["EV-01", "EV-03"],
          "unresolvedPoints": ["Telemetry log EV-01 does not show weight returning after surge; sensor diagnostic test needed."]
        }
      ],
      "openQuestions": [
        "Did any other guests or servers observe the pedestal between 21:42 and 21:55?",
        "Do gallery alarm diagnostic logs show sensor recalibration around 21:42?"
      ],
      "suggestedNextChecks": [
        "Audit server room electrical and reset logs for 21:40–22:00.",
        "Interview second catering server assigned to the display room."
      ],
      "memoryDelta": {
        "added": [
          "Fact: Building electrical surge and breaker reset logged at 21:42:00 (EV-03).",
          "Claim: Witness Clara Bell states statue present at 21:55 (EV-02).",
          "Contradiction: Discrepancy between sensor telemetry drop at 21:42 (EV-01) and witness sighting at 21:55 (EV-02).",
          "Hypothesis H-2: Electrical surge anomaly at 21:42 with theft occurring after 21:55 (EV-01, EV-03)."
        ],
        "updated": [
          "Hypothesis H-1 updated to reflect unresolved witness and power-surge factors."
        ],
        "explanation": "Ingested EV-02 and EV-03; identified that sensor drop at 21:42 may be an artifact of the logged electrical surge rather than physical removal, given witness observation at 21:55."
      },
      "createdAt": "2026-10-31T02:18:00.000Z"
    }
  }
  ```
* **Failure Responses:**
  * `409 Conflict`: Concurrent report generation attempted with the same version number. Client should refetch latest report and retry.
  * `422 Unprocessable Entity`: AI output failed validation (e.g., cited non-existent evidence codes or made a definitive guilt assertion).
  * `502 Bad Gateway`: External LLM provider timeout or invalid format. Evidence remains safely stored in MongoDB.

---

### 4.4 Memories

#### `GET /api/cases/:caseId/memories`
Retrieves all current working memory items for the case.
* **Query Parameters (Optional):** `?status=active` (default returns all active items)
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "67232e03a1b2c3d4e5f60020",
        "caseId": "67232e01a1b2c3d4e5f60001",
        "category": "fact",
        "statement": "Display pedestal pressure sensor recorded 15.2kg drop to 0kg at 21:42:10.",
        "supportingEvidenceCodes": ["EV-01"],
        "status": "active",
        "lastUpdatedInVersion": 1,
        "changeReason": "Initialized from direct digital telemetry log EV-01.",
        "updatedAt": "2026-10-31T02:10:00.000Z"
      },
      {
        "_id": "67232e03a1b2c3d4e5f60021",
        "caseId": "67232e01a1b2c3d4e5f60001",
        "category": "claim",
        "statement": "Server Clara Bell asserts statue was still present at 21:55.",
        "source": "Server Clara Bell interview",
        "supportingEvidenceCodes": ["EV-02"],
        "status": "active",
        "lastUpdatedInVersion": 2,
        "changeReason": "Added unverified claim from witness statement EV-02.",
        "updatedAt": "2026-10-31T02:18:00.000Z"
      },
      {
        "_id": "67232e03a1b2c3d4e5f60022",
        "caseId": "67232e01a1b2c3d4e5f60001",
        "category": "contradiction",
        "statement": "Conflict regarding theft timeline: Sensor triggered at 21:42 (EV-01) vs witness sighting at 21:55 (EV-02).",
        "supportingEvidenceCodes": ["EV-01", "EV-02"],
        "conflictingEvidenceCodes": ["EV-01", "EV-02"],
        "status": "active",
        "lastUpdatedInVersion": 2,
        "changeReason": "Identified direct temporal conflict between sensor and witness.",
        "updatedAt": "2026-10-31T02:18:00.000Z"
      },
      {
        "_id": "67232e03a1b2c3d4e5f60024",
        "caseId": "67232e01a1b2c3d4e5f60001",
        "category": "fact",
        "statement": "Building power surge and circuit breaker reset occurred at 21:42:00.",
        "supportingEvidenceCodes": ["EV-03"],
        "status": "active",
        "lastUpdatedInVersion": 2,
        "changeReason": "Added verified maintenance logbook entry EV-03.",
        "updatedAt": "2026-10-31T02:18:00.000Z"
      },
      {
        "_id": "67232e03a1b2c3d4e5f60023",
        "caseId": "67232e01a1b2c3d4e5f60001",
        "category": "hypothesis",
        "statement": "Electrical surge at 21:42 caused sensor anomaly; theft occurred after 21:55.",
        "supportingEvidenceCodes": ["EV-01", "EV-03"],
        "hypothesisDetails": {
          "hypothesisId": "H-2",
          "title": "Electrical Surge / Sensor Anomaly (Theft After 21:55)",
          "rationale": "Logged power surge at 21:42 coincides with sensor zero-reading; statue was seen at 21:55 by witness.",
          "unresolvedPoints": ["Telemetry EV-01 does not show weight returning; requires electrical diagnostics."]
        },
        "status": "active",
        "lastUpdatedInVersion": 2,
        "changeReason": "Formulated alternative working hypothesis incorporating power surge EV-03.",
        "updatedAt": "2026-10-31T02:18:00.000Z"
      }
    ]
  }
  ```

---

### 4.5 Reports & History

#### `GET /api/cases/:caseId/reports`
Lists all generated report versions for the case, ordered by `version` descending (newest first).
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "67232e04a1b2c3d4e5f60031",
        "version": 2,
        "summary": "Chronological conflict identified between display sensor telemetry (21:42) and witness sighting (21:55). Confounding electrical surge recorded at 21:42.",
        "triggerEvidenceCode": "EV-03",
        "createdAt": "2026-10-31T02:18:00.000Z"
      },
      {
        "_id": "67232e04a1b2c3d4e5f60030",
        "version": 1,
        "summary": "Initial baseline established: Display pedestal sensor recorded a 15.2kg weight drop at 21:42:10.",
        "triggerEvidenceCode": "EV-01",
        "createdAt": "2026-10-31T02:10:00.000Z"
      }
    ]
  }
  ```

#### `GET /api/cases/:caseId/reports/:version`
Retrieves the complete, immutable report payload for a specific version number.
* **Response `200 OK`:** Returns the full report object identical to the data object returned in `POST /api/cases/:caseId/analyze`.

---

## 5. AI Module Architecture & Function Interface

In accordance with [`PROJECT_RULES.md`](file:///c:/Users/Lenovo/OneDrive/Documents/Coding%20Projects/CaseMind/PROJECT_RULES.md), the AI logic resides in the root-level `ai/` folder as a pure code module. It is **not** a microservice, HTTP server, or separate deployment.

### 5.1 Architecture & Separation of Concerns
* **No Database Access:** The `ai/` module must **not** import a MongoDB client or perform database queries/writes.
* **Backend Responsibility:** The `backend/` application fetches case-scoped data from MongoDB, passes plain JavaScript objects into `ai/`, performs database-level citation verification on the output, and persists the report and memories.
* **Module Calling Flow:**
  ```text
  backend/ (Express Controller)
      │
      ├── 1. Fetches Case, Evidence[], ActiveMemories[] from MongoDB
      │
      ├── 2. Calls analyzeInvestigation({ caseDetails, evidenceList, currentMemories })
      │         │
      │         ▼
      │      ai/ (Module)
      │         ├── Builds LLM System & User Prompts
      │         ├── Invokes LLM SDK with Structured Output enforcement
      │         ├── Validates JSON Schema & Guilt-claim prohibition
      │         └── Returns Structured Analysis & Proposed Memory Updates
      │
      ├── 3. Verifies cited evidenceCodes against MongoDB records
      ├── 4. Allocates version and persists Report document
      └── 5. Applies memory mutations in MongoDB
  ```

### 5.2 Exported Function Interface
The root-level `ai/` module must export the primary synthesis function:

```typescript
// Interface defined in ai/
interface AnalyzeInvestigationInput {
  caseDetails: {
    id: string;                      // 24-char hex string
    title: string;
    description: string;
    status: "open" | "closed";
  };
  evidenceList: Array<{
    evidenceCode: string;            // e.g. "EV-01"
    title: string;
    content: string;
    source: string;
    sourceType: "witness" | "physical" | "digital" | "document" | "cctv";
    verificationStatus: "verified" | "unverified" | "disputed";
    occurredAt: string;              // ISO-8601 string
  }>;
  currentMemories: Array<{
    id: string;
    category: "fact" | "claim" | "contradiction" | "inference" | "hypothesis" | "open_question";
    statement: string;
    supportingEvidenceCodes: string[];
    conflictingEvidenceCodes?: string[];
    hypothesisDetails?: {
      hypothesisId: string;
      title: string;
      rationale: string;
      unresolvedPoints: string[];
    };
    source?: string;
  }>;
}

interface AnalyzeInvestigationOutput {
  summary: string;
  knownFacts: Array<{
    statement: string;
    evidenceCodes: string[];
  }>;
  unverifiedClaims: Array<{
    statement: string;
    source: string;
    evidenceCodes: string[];
  }>;
  evidenceConnections: Array<{
    connection: string;
    evidenceCodes: string[];
  }>;
  contradictions: Array<{
    pointOfConflict: string;
    conflictingEvidenceCodes: string[];
  }>;
  possibleHypotheses: Array<{
    hypothesisId: string;
    title: string;
    rationale: string;
    supportedBy: string[];
    unresolvedPoints: string[];
  }>;
  openQuestions: string[];
  suggestedNextChecks: string[];
  memoryUpdates: Array<{
    category: "fact" | "claim" | "contradiction" | "inference" | "hypothesis" | "open_question";
    statement: string;
    supportingEvidenceCodes: string[];
    conflictingEvidenceCodes?: string[];
    hypothesisDetails?: {
      hypothesisId: string;
      title: string;
      rationale: string;
      unresolvedPoints: string[];
    };
    source?: string;
    action: "add" | "update" | "supersede";
    changeReason: string;
  }>;
  explanationOfChange: string;
}

export async function analyzeInvestigation(
  input: AnalyzeInvestigationInput
): Promise<AnalyzeInvestigationOutput>;
```

### 5.3 Canonical Schema Mapping & Conversion
CaseMind standardizes on **camelCase** across all persisted documents and API responses. The AI module enforces this structured format. For flexibility across LLM providers, if an LLM returns snake_case keys, the AI module transforms them to canonical camelCase before returning:

| Raw LLM Key | Canonical Output Field | Type |
| :--- | :--- | :--- |
| `summary` | `summary` | `string` |
| `known_facts` / `knownFacts` | `knownFacts` | `Array<{ statement, evidenceCodes }>` |
| `unverified_claims` / `unverifiedClaims` | `unverifiedClaims` | `Array<{ statement, source, evidenceCodes }>` |
| `evidence_connections` / `evidenceConnections` | `evidenceConnections` | `Array<{ connection, evidenceCodes }>` |
| `contradictions` | `contradictions` | `Array<{ pointOfConflict, conflictingEvidenceCodes }>` |
| `possible_hypotheses` / `possibleHypotheses` | `possibleHypotheses` | `Array<{ hypothesisId, title, rationale, supportedBy, unresolvedPoints }>` |
| `open_questions` / `openQuestions` | `openQuestions` | `string[]` |
| `suggested_next_checks` / `suggestedNextChecks` | `suggestedNextChecks` | `string[]` |
| `memory_updates` / `memoryUpdates` | `memoryUpdates` | `Array<MemoryUpdateItem>` |
| `explanation_of_change` / `explanationOfChange` | `explanationOfChange` | `string` |

### 5.4 Strict Guardrails
1. **Self-Validation:** `ai/` checks that output contains all required fields and no empty strings where arrays are expected.
2. **Citation Check in Backend:** `backend/` validates that every code in `evidenceCodes`, `conflictingEvidenceCodes`, and `supportedBy` exists in the database for that `caseId`. Missing codes reject with `422 Unprocessable Entity`.
3. **Guilt Determination Ban:** The AI module prompt strictly forbids declaring legal guilt or innocence.

---

## 6. Persistence Sequence, Concurrency & Consistency

### 6.1 Two-Phase Decoupled Workflow
Evidence ingestion and AI analysis are strictly decoupled to guarantee zero evidence loss:

```text
[Phase 1: Evidence Ingestion (Synchronous & Permanent)]
  Client POST /api/cases/:caseId/evidence
       ↓
  Commit to MongoDB 'evidence' collection
       ↓
  Return 201 Created to Client (Evidence is permanent and safe)

[Phase 2: AI Analysis & Synthesis]
  Client POST /api/cases/:caseId/analyze
       ↓
  1. Fetch case, evidence, and active memories from MongoDB
       ↓
  2. Call ai/ module: analyzeInvestigation(...)
     [On LLM Timeout/Failure -> Return 502 Bad Gateway. DB untouched.]
       ↓
  3. Validate JSON Schema & Evidence Citations in backend
     [On Missing Evidence Code -> Return 422 Unprocessable Entity. DB untouched.]
       ↓
  4. Safe Version Allocation & Report Insertion
     - Determine nextVersion = max(version) + 1
     - Insert into 'reports' with unique index { caseId: 1, version: 1 }
     [On Duplicate Key 11000 Error -> Return 409 Conflict. DB untouched.]
       ↓
  5. Apply Memory Updates to 'memories' collection
       ↓
  Return 201 Created with Report & Memory Delta
```

### 6.2 Database Consistency Strategies

#### Preferred Strategy: MongoDB Transactions
When running in an environment that supports MongoDB multi-document transactions (e.g., MongoDB Atlas or a local replica set):
* `backend/` executes step 4 (insert into `reports`) and step 5 (updates to `memories`) inside a single session transaction (`session.withTransaction(...)`).
* If either write fails, the entire transaction aborts. The database remains completely consistent.

#### Fallback Strategy: Standalone MongoDB (No Replica Set)
In environments where multi-document transactions are unavailable, atomicity cannot be guaranteed across separate collection writes. To maintain data integrity without transactions:
1. **Authoritative Write First:** The `reports` collection is strictly authoritative and immutable. The backend inserts the report document first, secured by the unique compound index `{ caseId: 1, version: 1 }`.
2. **Sequential Memory Mutation:** Only after the report write successfully commits does the backend apply mutations to the `memories` collection.
3. **Explicit Partial-Failure Recovery:**
   * If the report write succeeds but the subsequent memory mutation fails or crashes:
     - The backend logs a structured error (`PARTIAL_WRITE_UNRECONCILED`) containing `reportId` and `version`.
     - The backend provides a recovery reconciliation procedure (`reconcileCaseMemory(caseId)`): on subsequent queries or retry, the backend checks whether the latest report's `version` matches `lastUpdatedInVersion` in `memories`. If out of sync, it reconciles active memories directly from the authoritative report document.
   * **Rule:** Storing a `memoryDelta` alone does **not** guarantee consistency without an active reconciliation mechanism. Report versions remain immutable and serve as the single source of truth.

---

## 7. Complete Fictional Walkthrough

**Scenario: The Obsidian Gallery Heist**  
*A fictional case demonstrating evidence ingestion, distinction between sensor data and inferences, contradiction handling, and safe report versioning.*

### Step 1: Case Creation
* **Endpoint:** `POST /api/cases`
* **Request:**
  ```json
  {
    "title": "The Obsidian Gallery Heist",
    "description": "Fictional case: Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala."
  }
  ```
* **Response `201 Created`:**
  ```json
  {
    "success": true,
    "data": {
      "_id": "67232e01a1b2c3d4e5f60001",
      "title": "The Obsidian Gallery Heist",
      "description": "Fictional case: Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala.",
      "status": "open",
      "createdAt": "2026-10-31T02:00:00.000Z",
      "updatedAt": "2026-10-31T02:00:00.000Z"
    }
  }
  ```

---

### Step 2: Evidence Submission #1 (Telemetry Log)
* **Endpoint:** `POST /api/cases/67232e01a1b2c3d4e5f60001/evidence`
* **Request:**
  ```json
  {
    "title": "Display Case Tamper Sensor Log",
    "content": "Glass case pressure sensor dropped from 15.2kg to 0kg at 21:42:10.",
    "source": "Gallery Telemetry Server Log #81",
    "sourceType": "digital",
    "verificationStatus": "verified",
    "occurredAt": "2026-10-30T21:42:10.000Z"
  }
  ```
* **Response `201 Created`:** Returns evidence record with `_id: "67232e02a1b2c3d4e5f60010"` and `evidenceCode: "EV-01"`.

---

### Step 3: Initial AI Analysis (Report Version 1)
* **Endpoint:** `POST /api/cases/67232e01a1b2c3d4e5f60001/analyze`
* **Request:**
  ```json
  {
    "triggerEvidenceCode": "EV-01"
  }
  ```
* **Analysis Outcome:**
  * **Known Fact:** Display case pressure sensor dropped from 15.2kg to 0kg at 21:42:10 (`EV-01`).
  * **Inference:** A 15.2kg load was removed from the pedestal sensor at 21:42:10.
  * **Hypothesis (Provisional):** Statue may have been removed at 21:42:10. *(Crucial: This is NOT treated as proof of theft; unauthorized removal, legitimate maintenance, or sensor glitch remain open possibilities).*
  * **Open Question:** Did any other sensor or console record activity at 21:42?
  * **Report v1 Persisted:** Saved with `version: 1`.

---

### Step 4: Evidence Submission #2 & #3 (Introducing Witness & Document Data)
* **Endpoint:** `POST /api/cases/67232e01a1b2c3d4e5f60001/evidence`
* **Evidence EV-02 (Witness):**
  ```json
  {
    "title": "Catering Staff Witness Statement",
    "content": "Server Clara Bell asserts the statue was still on the pedestal when she served drinks near it at 21:55.",
    "source": "Witness Interview #1",
    "sourceType": "witness",
    "verificationStatus": "unverified",
    "occurredAt": "2026-10-30T21:55:00.000Z"
  }
  ```
  *Response assigns `evidenceCode: "EV-02"`.*

* **Evidence EV-03 (Maintenance Log):**
  ```json
  {
    "title": "Security Desk Logbook",
    "content": "Guard log shows building power surge and sub-panel circuit breaker reset occurred at 21:42:00.",
    "source": "Front Desk Incident Book Entry 14",
    "sourceType": "document",
    "verificationStatus": "verified",
    "occurredAt": "2026-10-30T21:42:00.000Z"
  }
  ```
  *Response assigns `evidenceCode: "EV-03"`.*

---

### Step 5: Second AI Analysis (Report Version 2)
* **Endpoint:** `POST /api/cases/67232e01a1b2c3d4e5f60001/analyze`
* **Request:**
  ```json
  {
    "triggerEvidenceCode": "EV-03"
  }
  ```
* **Analysis Outcome:**
  * **Known Facts:**
    1. Display pedestal pressure sensor registered complete load drop at 21:42:10 (`EV-01`).
    2. Building power surge and circuit breaker reset occurred at 21:42:00 (`EV-03`).
  * **Unverified Claims:**
    1. Witness Clara Bell states statue was present at 21:55 (`EV-02`).
  * **Contradiction Identified:** Sensor telemetry (`EV-01`) indicates weight loss at 21:42, but witness statement (`EV-02`) asserts the statue was observed in place at 21:55. Security logbook (`EV-03`) reports a simultaneous electrical surge at 21:42. Neither source is ruled out.
  * **Competing Hypotheses:**
    * `H-1`: Statue removed at 21:42; witness Clara Bell (`EV-02`) is mistaken or misremembered the time. Supported by `["EV-01"]`.
    * `H-2`: Electrical surge (`EV-03`) caused a false telemetry drop on the pedestal at 21:42; physical removal occurred after 21:55. Supported by `["EV-01", "EV-03"]`. (Power-surge explanation is strictly hypothetical; sensor telemetry did not record weight returning).
  * **Report v2 Persisted:** Saved with `version: 2`. Report v1 remains untouched.

---

## 8. Team Member Responsibilities & Integration Checklist

| Member | Focus Domain | Key Integration Responsibilities |
| :--- | :--- | :--- |
| **Member 1** | **Backend & Persistence (`backend/`)** | • Express server setup with MongoDB connection.<br>• Implement schemas and indexes: unique `{ caseId: 1, version: 1 }` on `reports` and unique `{ caseId: 1, evidenceCode: 1 }` on `evidence`.<br>• Serialization: convert BSON `ObjectId` to 24-character hex strings in all JSON responses.<br>• REST endpoints for cases, evidence, and report version retrieval.<br>• Retrieve case-scoped context and call `analyzeInvestigation` in `ai/`.<br>• Citation verification: ensure cited `evidenceCodes` exist in DB before saving.<br>• Transactional / authoritative persistence of report versions and memory updates. |
| **Member 2** | **AI Analysis & Memory Logic (`ai/`)** | • Implement root-level `ai/` module exporting `analyzeInvestigation({ caseDetails, evidenceList, currentMemories })`.<br>• Zero direct MongoDB access; operate strictly on input arguments.<br>• Prompt engineering with strict camelCase structured output.<br>• Self-validation: ensure schema compliance and strict ban on guilt determinations.<br>• Taxonomy classification: distinguish facts, unverified claims, inferences, hypotheses, contradictions, and open questions.<br>• Formulate the memory delta (added/updated items). |
| **Member 3** | **Frontend & Verification (`frontend/`)** | • Single-page UI with Case view, Evidence submission form, Memory Inspector, and Report Timeline.<br>• Render `occurredAt` alongside `createdAt` in evidence lists.<br>• Render Memory Inspector with clear badges for Fact, Claim, Contradiction, Inference, Hypothesis, and Open Question.<br>• Display report version history (`v1`, `v2`, etc.) and the "What changed and why" memory explanation.<br>• Test full end-to-end flow from case creation to Report v2. |

---

## 9. Implementation Decisions & Tech Stack Status

The following technology selections are explicitly tracked for team consensus:

| Technology Domain | Status | Candidates / Scope |
| :--- | :--- | :--- |
| **MongoDB Access Layer** | `PENDING TEAM DECISION` | • Option A: Native Node.js `mongodb` driver (zero abstraction, high speed).<br>• Option B: `mongoose` (declarative schema validation, automatic casting). |
| **LLM Provider & SDK** | `PENDING TEAM DECISION` | • Option A: Google Gemini API via `@google/genai` (structured JSON mode).<br>• Option B: OpenAI API via `openai` (Structured Outputs mode). |
| **Persistence Consistency** | Defined with Fallback | • Preferred: MongoDB multi-document transactions (Atlas or replica set).<br>• Fallback: Authoritative report write first, followed by sequential memory mutation and reconciliation recovery. |

---

## 10. MVP Boundary (Strict Hackathon Scope)

To ensure completion within the 24-hour hackathon, the following are strictly OUT OF SCOPE:
* ❌ Vector Search / RAG embeddings (direct DB fetch of case evidence is fast and reliable for MVP).
* ❌ Multi-agent debate loops or autonomous tool calling.
* ❌ Graph databases or heavy force-directed graph libraries.
* ❌ PDF report export.
* ❌ Multi-tenant authentication / role-based access.
