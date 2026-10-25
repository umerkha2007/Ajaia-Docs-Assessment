# Implementation Plan

## 1. Objective

Build a maintainable document editor MVP that supports document creation and editing, rich-text formatting, file import, ownership, sharing between seeded users, and persistent storage.

Automated tests must be written alongside implementation from Phase 1 onward. Every phase must have verifiable acceptance criteria before it can be marked complete.

## 2. Implementation Principles

- Follow `Agents.md` for all implementation tasks.
- Read `Architecture.md`, `Roadmap.md`, and relevant requirements before making changes.
- Implement incrementally, testing each feature before proceeding.
- Use a zero-cost technology stack and persistence solution.
- Keep UI, business logic, persistence, and permission enforcement appropriately separated.
- Prefer core functionality over optional stretch features.
- Update `Changelog.md` whenever files change.
- Never mark unverified functionality as complete.

## 3. Phased Implementation

### Phase 1: Scaffold, Architecture and Test Setup

**Focus**
- Inspect the repository and confirm the existing technology stack.
- Establish the application structure and local development environment.
- Configure the automated test runner.
- Define the architecture, data model, persistence strategy, and seeded-user approach.
- Create `Agents.md` and `Architecture.md`.

**Acceptance criteria**
- [x] Application starts successfully.
- [x] Test runner is configured and executable.
- [x] At least one baseline automated test passes.
- [x] Architecture and implementation rules are documented.
- [x] No required dependency or service incurs a mandatory cost.

**Exit gate:** The application runs, and automated tests can be executed reliably.

### Phase 2: Document CRUD and Persistence

**Focus**
- Create, rename, edit, save, reopen, and delete documents.
- Implement document listing and ordering.
- Define document ownership.
- Persist document content and metadata.

**Automated tests**
- [x] Create a document.
- [x] Rename a document.
- [x] Edit and save document content.
- [x] Reopen a saved document.
- [x] Delete a document.
- [x] Verify document ordering.
- [x] Refresh or restart the application and verify persistence.

**Exit gate:** Document operations work, and saved documents survive the required reload scenario.

### Phase 3: Rich-Text Editor

**Focus**
- Integrate the rich-text editor with document persistence.
- Implement the required formatting toolbar.
- Establish a canonical representation of editor content.

**Automated tests**
- [x] Apply bold formatting.
- [x] Apply italic formatting.
- [x] Apply underline formatting.
- [x] Create headings with different levels or sizes.
- [x] Create bulleted lists.
- [x] Create numbered lists.
- [x] Save and reload formatted content without losing its structure.

**Exit gate:** Required formatting works and survives saving, reopening, and refreshing.

### Phase 4: File Upload

**Focus**
- Support `.txt` and `.md` file imports.
- Convert imported content into a new editable document.
- Validate file types and handle malformed or empty input appropriately.
- Display supported file types in the UI and README.

**Automated tests**
- [x] Import a valid `.txt` file.
- [x] Import a valid `.md` file.
- [x] Verify imported content is editable and persisted.
- [x] Reject unsupported file types with a clear error.
- [x] Handle empty, invalid, or unreadable files.
- [x] Verify imported content is rendered safely.

**Exit gate:** Supported files produce editable documents, and invalid uploads fail safely.

### Phase 5: Seeded Users and Sharing

**Focus**
- Create deterministic seeded accounts.
- Allow switching between seeded users.
- Implement document ownership and sharing grants.
- Separate owned documents from documents shared with the current user.
- Persist sharing state.

**Automated tests**
- [x] Verify each document has an owner.
- [x] Grant another user access to a document.
- [x] Verify the recipient can access the shared document.
- [x] Verify owned and shared documents are visibly distinguished.
- [x] Revoke access and verify it is rejected.
- [x] Verify sharing state survives refresh or restart.
- [x] Verify users cannot access documents they do not own or have permission to access.

**Exit gate:** Sharing works across seeded accounts, persists, and enforces access restrictions.

### Phase 6: Error Handling and Test Completion

> **Skipped (time constraint)** by owner decision on 2026-10-25. Not done as a dedicated phase; see `Roadmap.md` for which of the items below are nevertheless covered by tests from other phases and which remain open.

**Focus**
- Review validation and error handling across all implemented features.
- Handle persistence failures, invalid operations, and missing records.
- Close test gaps identified during earlier phases.

**Automated tests**
- [ ] Failed saves produce an understandable error without silently losing data.
- [ ] Invalid titles and inputs are rejected appropriately.
- [ ] Missing documents are handled safely.
- [ ] Unsupported uploads are rejected.
- [ ] Unauthorized reads and writes are rejected.
- [ ] Existing tests continue to pass after fixes.

**Exit gate:** Core failure scenarios are handled, and no known critical test failures remain.

### Phase 7: Integration and Usability

> **Skipped (time constraint)** by owner decision on 2026-10-25. Not done as a dedicated phase; see `Roadmap.md` for which of the items below are nevertheless covered by tests from other phases and which remain open.

**Focus**
- Validate the complete workflow across two seeded users.
- Improve navigation, feedback, and basic editor usability.
- Run regression tests across all implemented features.

**End-to-end test**
- [ ] Open the application as User A.
- [ ] Create and format a document.
- [ ] Save it and verify persistence after refresh.
- [ ] Import a supported file.
- [ ] Share a document with User B.
- [ ] Switch to User B and open the shared document.
- [ ] Verify User B cannot access unshared documents.
- [ ] Revoke sharing as User A and verify access is denied.
- [ ] Run the complete automated test suite.

**Exit gate:** The main workflow works end to end, with no known critical regressions.

### Phase 8: Documentation and Final Verification

**Focus**
- Complete and verify all required documentation.
- Run the final automated test suite, linting, type checking, and production build where applicable.
- Record outstanding work and limitations.

**Required documentation**
- [x] `Agents.md`: agent implementation and verification rules.
- [x] `Architecture.md`: actual architecture and technical decisions.
- [x] `Changelog.md`: every changed file, timestamp with timezone, reason, and change description.
- [x] `Local-setup.md`: prerequisites, installation, initialization, seeded accounts, run commands, and troubleshooting.
- [x] `Testing-guide.md`: test commands, test organization, requirement-to-test mapping, and manual verification.
- [x] `Roadmap.md`: phase status, completed work, outstanding requirements, blockers, and next steps.

**Final acceptance criteria**
- [x] All mandatory functional requirements have been checked against their acceptance criteria.
- [x] Test results are based on commands actually executed.
- [x] Failed, skipped, and unexecuted tests are reported honestly.
- [x] Known defects and incomplete requirements are documented.
- [ ] Local setup works without paid services. (Not ticked: every dependency is free and open source and nothing calls an external service at run time, but a clean-machine install was not repeated, and tests were not run with the network disabled.)
- [x] Any remaining work includes a practical next step and an estimate of 2–4 additional hours where appropriate.

**Exit gate:** The final handoff accurately describes what works, what has been verified, and what remains incomplete.

## 4. Progress Tracking

Update this table as implementation progresses. Do not mark a phase complete until its exit gate has been met.

| Phase | Status | Evidence / notes |
|---|---|---|
| 1. Scaffold and test setup | Complete (pending owner review) | 2026-10-25: `npm run verify` exit 0 (16 Vitest tests pass), `npm run test:e2e` 1 pass. Details in `Roadmap.md` |
| 2. Document CRUD and persistence | Complete (pending owner review) | 2026-10-25: `npm run verify` exit 0 (94 Vitest tests pass), `npm run test:e2e` 6 pass (also headed Chrome). Details in `Roadmap.md` |
| 3. Rich-text editor | Complete (pending owner review) | 2026-10-25: `npm run verify` exit 0 (152 Vitest tests pass), `npm run test:e2e` 12 pass, also in headed Chrome. Details in `Roadmap.md` |
| 4. File upload | Complete (pending owner review) | 2026-10-25: `npm run verify` exit 0 (267 Vitest tests pass), `npm run test:e2e` 28 pass, also in headed Chrome. Details in `Roadmap.md` |
| 5. Seeded users and sharing | Complete (pending owner review) | 2026-10-25: `npm run verify` exit 0 (387 Vitest tests pass), `npm run test:e2e` 39 pass, also in headed Chrome. Details in `Roadmap.md` |
| 6. Error handling and test completion | Skipped (time constraint) | Owner decision, 2026-10-25. Most of its listed tests exist from earlier phases; database-failure injection and a global error review were not done. See `Roadmap.md` |
| 7. Integration and usability | Skipped (time constraint) | Owner decision, 2026-10-25. The two-user steps are covered by separate browser tests, but there is no single end-to-end scenario and no usability review. See `Roadmap.md` |
| 8. Documentation and final verification | Complete (with documented gaps) | 2026-10-25 16:45 PDT: 490 Vitest tests, 51 Playwright tests, typecheck, lint, build all run; six docs current; gaps listed in `Roadmap.md` |

Use only these statuses: `Not started`, `In progress`, `Blocked`, `Complete`, and (added by the owner on 2026-10-25 for Phases 6 and 7) `Skipped (time constraint)`.

## 5. Scope Boundaries

### Required for MVP
- Document creation, editing, renaming, saving, reopening, and deletion.
- Bold, italic, underline, headings, bulleted lists, and numbered lists.
- `.txt` and `.md` imports.
- Ownership and sharing between seeded users.
- Persistent content, formatting, and sharing state.
- Automated tests, validation, error handling, and all required documentation.

### Deferred until core requirements pass

> Update (2026-10-25): real-time collaboration was brought forward at the owner's request after last-save-wins lost data. It is implemented as automatic saving plus merge-by-edit syncing over HTTP polling (see `Architecture.md`, "Live editing"). It is additional to the eight phases and does not change their status.
- Real email/password authentication.
- Real-time collaboration.
- Comments and suggestions.
- Version history.
- PDF or Markdown export beyond the required import functionality.
- Production-scale deployment infrastructure.

Any deferred functionality must be identified as out of scope or incomplete rather than represented as implemented.

## 6. Definition of Done

The MVP is complete only when all mandatory requirements are implemented, relevant automated tests have been executed, critical failures are resolved, persistence and access control are verified, and all required documentation reflects the actual implementation.

A successful build alone is not sufficient evidence of completion.