# Agent Implementation and Verification Rules

## 1. Mandatory Instructions

Before starting any task, read:

- `Agents.md`
- `Architecture.md`
- `Roadmap.md`
- Relevant functional requirements
- `Testing-guide.md`, if it exists

Treat these files as the source of truth. Resolve conflicting instructions explicitly before proceeding.

Do not rewrite working code, replace established technologies, add unnecessary dependencies, or implement stretch features before the core requirements pass.

## 2. Incremental, Test-First Implementation

Work in small, independently verifiable stages.

For every feature:

1. Identify the relevant requirement IDs and acceptance criteria.
2. Inspect the existing implementation and tests.
3. Write or update automated tests for the expected behavior, including failure cases.
4. Implement the smallest change that satisfies the requirements.
5. Run the relevant tests and inspect the results.
6. Fix failures and regressions before moving on.
7. Update the documentation and changelog.

Establish the application, test runner, and at least one passing baseline test before implementing features.

Do not postpone testing until the end. Tests must be written alongside each feature's implementation.

At the end of each stage, run applicable tests, linting, type checking, and build checks. Update `Roadmap.md` with verified progress and outstanding work.

## 3. Testing and Reporting

Use appropriate test layers:

- **Unit tests:** document operations, validation, import conversion, and permission logic.
- **Integration tests:** persistence, reload behavior, sharing, and access control.
- **UI or end-to-end tests:** critical user workflows, including document editing and sharing between seeded users.

Test successful behavior and meaningful failure cases, including invalid input, unsupported files, failed saves, missing documents, and unauthorized access.

Every meaningful test must assert the expected outcome, not merely that code executes or an operation returns success.

### Test organization and output

- Group tests under clear feature headings, such as Document CRUD, Rich-Text Formatting, File Import, Sharing, Persistence, and Error Handling.
- Give each test a descriptive name that identifies the behavior being verified.
- Use the test runner's reporting features to display results by feature where supported.
- Make failures easy to diagnose by including the failed assertion and relevant error details.
- Maintain a mapping between functional requirement IDs and their automated tests in `Testing-guide.md`.

Run focused tests after each change and the full relevant suite at integration checkpoints.

Never claim a test passed unless it was executed and its result was observed. Report failed, skipped, and unexecuted tests accurately. Never weaken tests merely to obtain a passing result.

Tests must be deterministic and must not require paid services, external APIs, or network availability.

## 4. Architecture and Code Quality

Document the actual technology stack, application boundaries, data flow, document and sharing models, persistence strategy, editor content representation, simulated authentication, authorization, error handling, and testing approach in `Architecture.md`.

Keep UI, business logic, persistence, and permission enforcement appropriately separated.

Prefer simple, maintainable solutions over premature abstractions or unnecessary infrastructure. Use established libraries when they materially reduce implementation risk.

Choose a zero-cost persistence solution appropriate to the application, such as SQLite or IndexedDB. Do not introduce a required paid dependency or service.

## 5. Data Integrity and Security

- Give every document an explicit owner.
- Enforce sharing permissions on every relevant document read and write.
- Clearly distinguish owned documents from documents shared with the current user.
- Persist document content, formatting, ownership, and sharing state.
- Validate titles, identifiers, uploaded files, and other user-controlled input.
- Sanitize imported and rendered content.
- Handle failed writes, missing records, and invalid state without silently losing data.
- Never trust client-provided ownership or permission fields.
- Document the limitations of seeded users, simulated authentication, and local persistence.

Hiding a UI element is not authorization. Access restrictions must be enforced in the relevant data or application layer.

## 6. Required Documentation

Maintain these files throughout implementation:

- `Agents.md`: persistent instructions for every coding task.
- `Architecture.md`: actual architecture, data model, dependencies, and technical decisions.
- `Changelog.md`: every changed file, timestamp with timezone, reason, and concise description of its changes.
- `Local-setup.md`: prerequisites, installation, initialization, run commands, seeded accounts, and troubleshooting.
- `Testing-guide.md`: test commands, test organization, requirement-to-test mapping, and manual verification steps.
- `Roadmap.md`: completed work, outstanding requirements, blockers, known limitations, and next steps.

Update the relevant documentation in the same stage as each implementation change.

Use actual timestamps; never invent historical timestamps. Do not document functionality, test results, or deployment capabilities as verified unless they have been verified.

## 7. Scope and Change Management

Keep changes focused on the current stage. Do not silently remove functionality, suppress errors, introduce fake success responses, or substitute in-memory state for required persistence.

If a requirement cannot be completed within the available time:

1. State what works and what remains incomplete.
2. Identify the affected requirement IDs and the reason for the gap.
3. Record the blocker and next implementation step in `Roadmap.md`.
4. Estimate the additional 2–4 hours of work where appropriate.

Prioritize mandatory requirements over optional stretch features.

## 8. Final Acceptance Gate

Before declaring the MVP complete:

1. Run the full automated test suite.
2. Run applicable lint, type-check, and production build commands.
3. Verify document creation, renaming, editing, saving, reopening, and persistence after refresh or restart as applicable.
4. Verify supported file imports and unsupported-file error handling.
5. Verify rich-text formatting and structure survive reload.
6. Verify ownership, sharing, revocation, and access restrictions using different seeded users.
7. Verify the application can be set up without paid services.
8. Reconcile every functional requirement with its acceptance criteria and test results.
9. Confirm all six required documentation files are current.
10. Report known defects, incomplete requirements, test results, commands executed, setup instructions, and remaining work.

The final report must distinguish verified functionality from assumptions. Never declare the MVP complete while a mandatory requirement remains unverified.