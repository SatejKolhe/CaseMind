# CaseMind – Project Rules & Team Playbook (24-Hour Hackathon)

This document establishes the operating rules, technical constraints, team roles, and development protocols for building CaseMind within a 24-hour hackathon. All team members and their AI coding assistants must strictly follow these guidelines.

---

## 1. 24-Hour Time Discipline

* **Target Milestone:** Deliver a demonstrable end-to-end working workflow by **Hours 10–12**.
* **Priorities in Order:**
  1. Core functional flow (MVP)
  2. Early integration of backend, AI, and frontend
  3. End-to-end testing and validation
  4. Deployment & demonstration recording / submission
* **Scope Control:** Postpone all optional features whenever they threaten or delay the core MVP.
* **Lean Execution:** Avoid excessive documentation, over-engineered architectures, and premature abstractions.

---

## 2. Three-Member Ownership & Responsibilities

Each member owns their core domain, but works in tight alignment for early integration:

* **Member 1 (`backend/`):**
  * Backend application: server setup, MongoDB schemas and persistence, REST APIs, case/evidence endpoints, and report-version storage.
* **Member 2 (`ai/`):**
  * AI and memory module: AI analysis pipelines, structured JSON output enforcement, evidence-reference validation logic, and agentic-memory logic.
* **Member 3 (`frontend/`):**
  * Frontend application: user interface, API integration, interactive memory inspector, report history view, and end-to-end user journey verification.
* **Collaboration Norms:**
  * Reassignment is permitted by mutual team agreement, but each component must always have exactly one accountable owner.
  * Integrate early and continuously rather than developing in isolation.

---

## 3. Minimal Folder Structure & Integration Model

Keep the layout clean, beginner-friendly, and easy to navigate. Create directories and files only when implementation requires them—no empty placeholders or speculative layers.

```text
CaseMind/
├── PROJECT_RULES.md      # Ground rules and playbook
├── README.md             # Project overview & run instructions
├── backend/              # Backend application (server, MongoDB persistence, REST APIs)
├── ai/                   # AI analysis and agentic-memory logic module
├── frontend/             # Frontend application (workspace, evidence submission, inspector, history)
└── docs/
    └── API_CONTRACT.md   # Shared API and MongoDB data contract
```

### Module Integration Model (No Microservices)
* **Direct Import:** The AI logic in `ai/` is a regular code module imported and called directly by the backend. Do **NOT** create a separate AI server, HTTP service, microservice, or standalone deployment.
* **Data Ownership & Boundary:**
  * The `backend/` application owns all database access, MongoDB connections, and persistent writes.
  * The `ai/` module does **not** connect directly to MongoDB. It receives the necessary case-scoped context (evidence and active memories) as input arguments and returns structured analysis and proposed memory updates.
  * The `backend/` validates the returned results against actual database records and handles persisting the new report version and updating case memory.
* **Simplicity Rule:** No microservices, no premature wrapper classes, and no deep folder nesting.

---

## 4. API and Data Contracts

* **Contract-First Agreement:** Team members must agree on API endpoints, request/response JSON payloads, and database document structures before beginning parallel coding.
* **Documentation:** Record shared schemas in `docs/API_CONTRACT.md` before or as soon as cross-team implementation begins.
* **Contract Stability:** Never modify a shared endpoint, request shape, or response contract without explicit discussion and consensus with affected teammates.
* **Early Integration:** Run integration tests between mock/real endpoints as soon as frontend and backend components exist.

---

## 5. Incremental AI-Assisted Coding

When using AI coding assistants (Gemini, Claude, Copilot, ChatGPT, etc.):

* **Bounded Tasks:** Execute one bounded, atomic task per prompt.
* **Inspect Before Editing:** Always inspect existing files and context before proposing or writing code.
* **Minimal Changes:** Make the smallest reasonable modification necessary to accomplish the task.
* **Verify Before Committing:** Run relevant tests, builds, or lint checks before claiming completion.
* **No Blind Retries:** If an error occurs, inspect the exact error message, locate the root cause, and fix it directly rather than looping blindly.
* **Honest Reporting:** Explain what was changed and explicitly report any unverified behaviors.

---

## 6. CaseMind Data Integrity & Ethical Grounding

CaseMind deals with investigative evidence and intelligence synthesis. High standards of data provenance and truthfulness are mandatory:

* **Fictional Data Only:** Use exclusively fictional cases, fictional characters, and synthetic evidence.
* **Provenance & Immutability:** Preserve original evidence entries along with their source, timestamp, and verification status.
* **Persistent Storage:** Store real evidence entries, working memory states, and report versions in MongoDB (no in-memory mock data for core flows).
* **Case Scoping:** Strictly scope all data retrieval, memory updates, and evidence citations to the active case ID.
* **Contradictions & Uncertainty:** Explicitly preserve contradictions and unknown facts in memory rather than smoothing them over.
* **Classification of Findings:** Clearly differentiate:
  1. *Facts* (verified source data)
  2. *Unverified claims* (witness statements, hearsay)
  3. *Inferences* (deductions from multiple data points)
  4. *Hypotheses* (working investigative theories)
* **Citation Validation:** Validate all AI-generated citations/evidence IDs against real database records.
* **No Guilt Determinations:** The system assists human investigators. Never state an unverified hypothesis as proven fact and never claim that the AI determines legal guilt or innocence.

---

## 7. Security and Error Handling

* **Secrets Management:** Never commit `.env` files, API keys, or database credentials to Git. Add `.env` to `.gitignore` immediately upon creation.
* **Backend Security:** All LLM API keys and database credentials must remain strictly on the backend.
* **No False Success:** Do not fake successful database writes, AI completions, or report generation.
* **Graceful Degradation & Atomic Safety:** If AI analysis fails after evidence has already been saved to MongoDB, preserve the evidence, report the failure honestly to the user, and allow retrying the analysis.
* **User Feedback:** Provide clear, actionable error messages and prominent loading states in the frontend.

---

## 8. Git and Collaboration Workflow

* **Shared Repository:** Work from the shared repository using short-lived feature branches (e.g., `feat/backend-case-api`, `feat/ai-structured-output`, `feat/frontend-case-view`).
* **Atomic Commits:** Make frequent, small, functional commits with clear messages.
* **Diff Inspection:** Inspect `git diff` and staged files before creating any commit.
* **Safe Operations:** Never run destructive Git commands (`git push --force`, `git reset --hard`) without explicit teammate coordination.
* **Conflict Resolution:** Communicate immediately when merge conflicts arise and resolve them collaboratively with the original code author.

---

## 9. MVP Priority

The single mandatory end-to-end workflow is:

```text
[Create Case]
      ↓
[Add Evidence]
      ↓
[Save to MongoDB]
      ↓
[Retrieve Relevant Prior Evidence & Working Memories]
      ↓
[Analyze via AI Pipeline]
      ↓
[Validate Structured Output & Citations]
      ↓
[Save New Report Version to MongoDB]
      ↓
[Display Report & Memory Delta in UI (What changed and why)]
```

### Optional Features (Forbidden from delaying the MVP):
* Vector search / RAG embeddings
* Graph or network visualization
* Multi-agent debate / complex orchestrations
* PDF report export
* Auxiliary management screens or complex role-based auth

---

## 10. Completion Protocol

At the end of every implementation task, the member/AI must provide a structured wrap-up report:

1. **Files Changed:** Exact list of added or modified files.
2. **What Was Implemented:** Brief summary of features or fixes added.
3. **Verification Performed:** Commands, unit tests, or manual checks run and their exact outcomes.
4. **Untested Behaviour:** Explicit disclosure of what was not yet tested.
5. **Contract / Schema Changes:** Any API endpoint or database schema changes that require teammate consensus.
6. **Recommended Next Step:** Exactly one bounded, prioritized task to undertake next.
