# PRD — Paperclip Master Chat Plugin Repository Improvements

## 1. Executive summary

This repository already proves the right product shape: a **plugin-owned Paperclip chat surface** mediated by **Hermes** rather than a chat-heavy Paperclip core. The repo is strongest in architectural direction and weakest in **production maturity**. It has a coherent worker/UI split, a documented Hermes seam, a useful VPS reuse path, and basic tests, but it is still operating as an alpha-quality implementation rather than a production-ready plugin package.

The biggest opportunities are:
- make Hermes integration more correct and observable,
- harden the security and operational posture,
- evolve persistence beyond a single plugin-state blob,
- improve UX from “functional demo” to “board-ready workflow,”
- deepen verification with real install/integration coverage,
- add release/CI/DX systems so contributors can safely iterate.

This PRD defines the requirements and roadmap for taking the repository from **credible prototype** to **production-oriented plugin package**.

---

## 2. Background and current state

### 2.1 Current strengths
The repository already has strong foundations:
- `src/worker.ts` provides the core bridge contract, scope-aware thread actions, persistence, activity logging, and gateway selection.
- `src/hermes/gateway.ts` cleanly separates `mock`, `http`, and host-local CLI execution modes.
- `src/ui/index.tsx` ships a complete page/widget/sidebar/detail-tab surface rather than just a raw API demo.
- `docs/*.md` explain architecture, config, integration modes, security posture, and VPS reuse.
- `tests/*.spec.ts` cover payload shaping, CLI invocation shaping, view-model logic, and a mock-backed plugin harness flow.

### 2.2 Current weaknesses observed in the repo
1. **Auto mode is not true auto-detection.** `createHermesGateway()` chooses CLI when `hermesCommand` is non-empty, and the default is always `"hermes"`. That means `auto` effectively means “CLI-first unconditionally,” not “detect and route safely.”
2. **CLI mode does not preserve real Hermes session continuity.** The worker stores `sessionId`, but `src/hermes/cli.ts` does not pass an existing Hermes session identifier back into the CLI path, so continuity is conceptual, not guaranteed.
3. **Scope selection is silently truncated today.** `src/paperclip/context.ts` fetches companies/projects/issues/agents with fixed `limit: 200` queries and then derives counts and selector options from the truncated result sets.
4. **Tool policy and tool descriptors can drift from thread policy.** The worker builds policy and descriptors from config defaults even when a thread has a different enabled toolset policy.
5. **Retry semantics are incorrect for future session continuity.** `retryLastTurnAction()` re-sends the last user message as a new turn instead of retrying the failed assistant continuation safely.
6. **Authorization integrity is under-specified in code.** The worker trusts caller-supplied company/project/issue/agent identifiers without explicit ownership validation against the current host/session context.
7. **The data model is too simple for scale.** `src/domain/store.ts` stores all threads and messages in one company-scoped state object with no indexing, pagination, migrations, or retention boundaries.
8. **The UX is functional but shallow.** `src/ui/index.tsx` exposes raw stream JSON, limited thread management, no explicit sending/error state machine, and no accessibility/testing scaffolding.
9. **Security controls are documented more than enforced.** The docs recommend quotas and stricter boundaries, but the runtime code does not yet implement request-size limits, rate limiting hooks, payload redaction, adapter authentication, or dangerous-tool suppression beyond config allowlists.
10. **Verification is mostly mocked.** There is no live Paperclip install test, no HTTP adapter contract suite, no CLI smoke test against a real Hermes runtime, and no browser/E2E coverage.
11. **Operational tooling is thin.** There is no CI workflow, release governance, compatibility matrix, or deployment/runbook automation.
12. **Contributor ergonomics are early.** There is no lint script, no format strategy, no fixtures directory, no examples, and no contributor guide.

---

## 3. Problem statement

The repository demonstrates the right architecture, but it does not yet provide the **correctness guarantees, operator confidence, contributor workflow, or UX polish** needed for broader adoption.

Without targeted improvements, the likely failure modes are:
- unreliable Hermes routing in environments where local CLI reuse is unavailable or inconsistent,
- incomplete scope pickers and wrong counts for larger tenants,
- policy drift between configured and thread-level tool permissions,
- confusing user experience during streaming, retries, and failures,
- cross-scope tampering or unvalidated scope references slipping through worker actions,
- scaling issues once thread/message volume grows,
- security drift between documented posture and implemented controls,
- regressions caused by limited automated verification,
- slow maintenance velocity due to missing CI and contributor tooling.

---

## 4. Product vision

Deliver the most credible standalone repository for a **Paperclip-native master chat plugin** by making it:
- **production-oriented** enough for serious internal deployment,
- **portable** across local VPS and adapter-backed environments,
- **safe by default** in worker/browser/runtime behavior,
- **observable and testable** in the places operators actually care about,
- **easy to install, evaluate, and extend** for contributors.

---

## 5. Goals

### 5.1 Product goals
1. Make the repository trustworthy as the reference implementation for Hermes-mediated Paperclip chat.
2. Improve runtime correctness for session handling, gateway selection, and failure recovery.
3. Improve board-user experience for scoping, streaming, attachment handling, and thread lifecycle.
4. Raise confidence with meaningful automated verification and deployment guidance.
5. Make the repo easier to maintain and extend over time.

### 5.2 Non-goals
- Turning this repository into Paperclip core functionality.
- Building a full multi-tenant SaaS backend outside Paperclip’s plugin model.
- Solving every future Paperclip runtime limitation inside this repo alone.
- Replacing Hermes with a generic provider abstraction unrelated to the stated architecture.

---

## 6. Users and stakeholders

### 6.1 Primary users
- **Board operators / Paperclip users** who need one scoped conversational surface across project/issue/agent context.
- **Plugin operators** who install and configure this plugin on a VPS or internal Paperclip deployment.
- **Maintainers/contributors** who evolve the repo over time.

### 6.2 Secondary stakeholders
- **Security reviewers** validating plugin trust boundaries and tool policies.
- **Platform engineers** operating Hermes and Paperclip together.
- **Paperclip plugin ecosystem developers** who may treat this repo as a pattern reference.

---

## 7. Opportunity matrix by axis

| Axis | Current state | Opportunity | Priority |
|---|---|---|---|
| Product clarity | Strong architectural story, but no explicit improvement roadmap | Turn the repo into a reference-grade package with a clearly staged roadmap | P0 |
| UX | Usable single-pane UI, minimal workflow sophistication | Add board-ready states, thread controls, and clearer streaming/tool surfacing | P1 |
| Architecture | Clean seam boundaries, but simple persistence and scope derivation | Harden gateway selection, session continuity, policy consistency, and scope correctness | P0 |
| Runtime integration | `mock/http/cli/auto` seam exists | Make `auto` truly adaptive; add richer HTTP/local structured traces and safer retries | P0 |
| Testing | Unit + harness tests only | Add contract, E2E, and live smoke coverage | P0 |
| Security | Good documented posture | Enforce runtime constraints and payload/tool safety | P0 |
| Operations | VPS reuse helper exists | Add CI, runbooks, observability, and compatibility checks | P0 |
| Release readiness | Buildable package artifact exists, but no release governance | Add versioning, changelog, compatibility, rollback, and publish workflow | P1 |
| Developer experience | Small approachable repo | Add linting, fixtures, contributor workflow, examples, and maintainability guardrails | P1 |

---

## 8. Prioritized requirements

### 8.1 P0 — Runtime correctness and reliability

#### R1. True gateway auto-detection
`gatewayMode=auto` must detect whether the local Hermes binary is actually available and runnable before choosing the CLI path.

**Requirements**
- Probe the configured Hermes command before selecting CLI.
- Fall back to HTTP when configured and CLI is unavailable.
- Fall back to mock only in explicitly non-production/dev cases.
- Emit structured reason codes for the selected path.
- Ship operator-facing documentation updates in the same change so the docs match the actual routing semantics.

**Why**
The current implementation makes `auto` effectively equal to CLI because `hermesCommand` is always populated.

#### R2. Real session continuity semantics
The system must either preserve real Hermes session continuity across turns or clearly document/degrade when continuity is unavailable.

**Requirements**
- Support passing a durable Hermes session identifier in the integration path that truly reuses conversation state.
- If CLI cannot guarantee continuation, expose that limitation in code and docs and prefer adapter-backed continuation for production.
- Distinguish “session label” from “session continuity guarantee” in the data model.

#### R3. Scope correctness, retry integrity, and policy consistency
The worker must keep scope catalogs, retry behavior, and tool policy wiring internally consistent.

**Requirements**
- Replace fixed-size scope bootstrap fetches with pagination, search, or explicit truncation signaling.
- Validate that displayed counts are not derived from silently truncated lists.
- Ensure thread-level toolset policy and emitted tool descriptors stay aligned.
- Make retry semantics idempotent and continuation-safe rather than duplicating user turns.

#### R4. Structured failure handling and observability
The worker must normalize gateway failures into typed error categories suitable for UI recovery and ops debugging.

**Requirements**
- Map failures to categories such as unavailable gateway, timeout, invalid config, upstream adapter error, and user-input rejection.
- Emit metrics/tags for gateway mode, failure category, and latency.
- Surface retryability and operator action hints.
- Define timeout budgets and circuit-breaker behavior for both CLI and HTTP paths.

### 8.2 P0 — Security and trust hardening

#### R5. Authorization integrity and scope enforcement
The worker must bind all actions and reads to the actual host/company/session context instead of trusting caller-supplied identifiers.

**Requirements**
- Validate that referenced project, issue, agent, and thread records belong to the active company context.
- Reject cross-company or out-of-scope identifiers rather than silently accepting them.
- Make per-thread actions ownership-aware and tamper-resistant.

#### R6. Runtime enforcement of documented safety controls
The repo must enforce the most important documented controls in code rather than only in docs.

**Requirements**
- Attachment size/type/count limits.
- Explicit `allowInlineImageData` enforcement in UI and worker paths.
- Tool allowlist filtering by thread policy and environment.
- Request throttling hooks or adapter-side quota integration points.
- Clear dangerous-mode warnings for host-local CLI reuse.
- One in-flight send per thread, plus idempotency keys or equivalent dedupe protection for retries.

#### R7. Safer content handling pipeline
The system must prepare for prompt- and content-based abuse.

**Requirements**
- Pre-send validation hooks.
- Sanitization and redaction before persistence, logging, and re-display.
- Prefer log-safe summaries over raw tool output persistence by default.
- Define attachment byte limits, preview-safety rules, and retention windows.
- Optional moderation hook seam before forwarding content to Hermes.
- Document which controls are plugin-enforceable versus adapter/Hermes-owned.

#### R8. Authenticated adapter boundary
The HTTP adapter path must use explicit service-to-service authentication.

**Requirements**
- Support a secure adapter auth mechanism such as signed headers, HMAC, mTLS, or equivalent replay-resistant service auth.
- Document operator setup requirements for adapter authentication.
- Fail closed when HTTP mode is configured without the required auth material.

### 8.3 P0 — Testing and verification maturity

#### R9. Multi-layer verification strategy
The repository must move beyond mocked confidence.

**Requirements**
- Preserve the current fast local `pnpm verify` path as the baseline contributor lane.
- Define which checks are required on every change versus opt-in smoke checks for special environments.
- Document environment prerequisites for CLI, adapter, Paperclip-install, and browser lanes.
- HTTP adapter contract tests.
- CLI smoke tests behind an opt-in environment gate.
- E2E plugin-install smoke test against a local Paperclip checkout.
- Browser/UI flow tests for compose, retry, archive, and attachment handling.
- Regression coverage for gateway selection and session continuity behavior.
- Regression coverage for scope pagination/truncation, policy consistency, and retry integrity.

### 8.4 P1 — UX and workflow depth

#### R10. Board-ready chat experience
The UI must evolve from a functional scaffold to a deliberate workflow surface.

**Requirements**
- Explicit empty/drafting/uploading/sending/streaming/error states.
- Better thread management: rename, unarchive, pin/filter/search, and clearer recency ordering.
- Tool trace cards and stream rendering instead of raw JSON blobs.
- Safer scope editing rules while a turn is in flight.
- Accessibility improvements for keyboard navigation, status announcements, and semantic controls.

#### R11. Attachment and asset maturity
The attachment path must become production-capable.

**Requirements**
- Short-term: safer inline attachment validation and previews.
- Mid-term: migration path to Paperclip asset-backed storage when host APIs permit.
- Explicit lifecycle rules for retention and deletion.

### 8.5 P1 — Data model and storage maturity

#### R12. Scalable thread/message storage model
Persistence must support larger usage without forcing a single monolithic state blob.

**Requirements**
- Add schema versioning, migration ownership, and retention boundaries inside the current store first.
- Separate thread metadata from message history when the host/runtime constraints justify the added abstraction.
- Add archival filters and pagination semantics.
- Define a migration/versioning strategy for persisted state.
- Prepare for future backing-store abstraction when Paperclip exposes richer storage APIs.

### 8.6 P1 — Operations, release readiness, and DX

#### R13. CI foundation and release system
The repo must be continuously verifiable and release-governed.

**Requirements**
- Minimal CI for typecheck, tests, build, and repo-health checks must land in the earliest foundation phase.
- Optional smoke checks must be clearly separated from required CI blockers.
- Versioning/release policy.
- Define the release artifact, changelog policy, support window, upgrade path, and rollback/downgrade guidance.
- Installation compatibility matrix (Paperclip version, Node version, Hermes mode).
- Release checklist and rollback guidance.

#### R14. Contributor ergonomics and maintainability
The repo must be easier to extend safely.

**Requirements**
- Lint/format workflow.
- Contributing guide.
- Fixtures/examples for common gateway and UI states.
- Better separation between reusable domain logic and UI rendering details.
- Preserve the current useful local workflows such as `pnpm verify`, `pnpm vps:check`, and UI preview ergonomics.
- Define module-boundary expectations, dependency update policy, migration ownership, and documentation/fixture upkeep responsibilities.

---

## 9. Implementation workstreams

### Workstream A — Runtime and gateway correctness
Focus files:
- `src/hermes/gateway.ts`
- `src/hermes/cli.ts`
- `src/hermes/payload.ts`
- `src/types.ts`
- `src/worker.ts`

Key outcomes:
- adaptive auto-selection
- explicit continuity semantics
- scope pagination/truncation correctness
- retry/idempotency safety
- structured errors and metrics
- richer local/HTTP trace normalization
- thread-policy/tool-descriptor consistency

### Workstream B — Data model and state evolution
Focus files:
- `src/domain/store.ts`
- `src/types.ts`
- `src/worker.ts`

Key outcomes:
- versioned persistence
- retention and migration boundaries
- smaller state units when justified by host/runtime constraints
- archival/pagination lifecycle
- migration plan for future asset storage

### Workstream C — UI/UX maturation
Focus files:
- `src/ui/index.tsx`
- `src/ui/view-model.ts`
- new UI test harness/E2E assets

Key outcomes:
- intentional state machine
- improved thread operations
- accessible streaming/tool rendering
- attachment safety and usability upgrades

### Workstream D — Security and operational safeguards
Focus files:
- `src/worker.ts`
- `src/hermes/gateway.ts`
- `docs/security.md`
- future adapter contracts/tests

Key outcomes:
- enforced limits and policies
- authorization integrity and adapter auth
- storage/log redaction
- better operator warnings
- gateway risk surfacing
- audit/metrics expansion

### Workstream E — CI, QA, and release readiness
Focus files:
- `package.json`
- future `.github/workflows/*`
- docs and scripts
- test suites

Key outcomes:
- minimal CI foundation + opt-in smoke lanes
- opt-in smoke environments
- clearer release flow
- contributor guidance

---

## 10. Phased roadmap

### Phase 1 — Correctness foundation (P0)
Ship the changes required to make the plugin trustworthy in runtime behavior.

**Includes**
- minimal CI foundation for typecheck/test/build before deeper hardening work
- true auto-detection/fallback
- scope pagination or explicit truncation signaling
- tool-policy consistency fixes
- retry/idempotency fixes
- session continuity clarification or real support
- structured gateway error taxonomy
- authorization integrity checks
- adapter authentication
- attachment/input limit enforcement
- expanded tests for gateway selection and failure modes

**Exit criteria**
- `auto` mode behaves predictably across environments
- scope pickers/counts are trustworthy for large tenants or explicitly signal truncation
- users/operators can tell why a gateway path was chosen
- retry no longer duplicates user turns
- failure classes are test-covered and surfaced cleanly
- required CI blockers run automatically on every change

### Phase 2 — Security + UX hardening (P0/P1)
Make the repo safer and the UI more reliable for real users.

**Includes**
- safer compose/stream/error flows
- thread lifecycle improvements
- accessible streaming/tool presentation
- stronger content/tool policy enforcement

**Exit criteria**
- board users can recover cleanly from failures
- risky attachment/tool behaviors are limited by default
- UX no longer exposes raw internal event structures as the primary stream affordance

### Phase 3 — Scale, ops, and release maturity (P1)
Prepare the repository for broader adoption and maintainability.

**Includes**
- storage model evolution
- expanded CI/smoke workflows beyond the minimal foundation
- compatibility matrix and release runbooks
- contributor docs, fixtures, examples

**Exit criteria**
- maintainers can ship changes with repeatable automation
- contributors have clear local and CI expectations
- state/persistence model is ready for higher message volume

### Phase 4 — Ecosystem excellence (P2)
Turn the repo into a high-quality reference implementation.

**Includes**
- richer first-party adapter support
- advanced telemetry and trace UX
- example deployments and operator dashboards
- future asset-backed and structured-tool integrations

---

## 11. Success metrics

### Product and UX metrics
- 90%+ successful first-send completion rate in non-mock environments
- meaningful reduction in user-visible retry loops caused by gateway/config errors
- improved task completion time for common workflows: create thread, send scoped message, inspect response, retry/archive

### Reliability metrics
- gateway-selection behavior covered by automated tests
- live smoke checks passing in both host-local and HTTP-backed configurations
- zero ambiguous “silent failure” classes in worker-gateway interactions

### Security/ops metrics
- enforced attachment and request limits in code
- adapter authentication enabled in HTTP deployments
- no cross-company scope tampering accepted by worker actions
- operator-facing install/runbook documentation sufficient for first-pass deployment without manual guesswork
- CI required for merge/release flow

### DX metrics
- one-command local verification path remains intact
- new contributors can reach a successful local verify flow quickly without unpublished tribal knowledge
- release process produces a reproducible artifact and rollback notes
- contributors can discover architecture, roadmap, and release expectations from the repo alone

---

## 12. Risks and open questions

1. **Paperclip runtime evolution risk** — future plugin APIs may change the optimal path for assets, storage, or UI integration.
2. **Hermes CLI capability uncertainty** — if the CLI cannot support durable session continuity or structured traces well, production maturity may require adapter-first operation.
3. **Host-local trust boundary trade-off** — the easiest VPS mode is also the loosest isolation boundary.
4. **Storage migration complexity** — moving from a single state blob to a richer model will need backward-compatible migration planning.
5. **Product overlap risk** — if Paperclip ships first-party chat features, this repo should differentiate as plugin/reference architecture rather than compete on surface area alone.

---

## 13. Phase 1 acceptance criteria

Phase 1 is complete when:
- `gatewayMode=auto` truly probes and selects between CLI and HTTP modes.
- the repo explicitly documents and/or implements real session continuity semantics.
- worker errors are normalized into typed categories with test coverage.
- inline attachments are validated and bounded, and `allowInlineImageData` is enforced.
- automated verification covers runtime selection, failure paths, and at least one non-mock smoke scenario.

---

## 14. Immediate next actions

1. Fix the gateway-selection semantics so `auto` is honest.
2. Add minimal CI before broader hardening work lands.
3. Decide whether production-grade session continuity will be CLI-based or adapter-based.
4. Fix scope truncation, policy consistency, and retry integrity issues.
5. Add typed error normalization, authorization checks, and gateway observability.
6. Broaden verification beyond mock-only coverage, then refactor the UX toward explicit interaction states and better stream/tool presentation.

---

## 15. Evidence appendix

Key repo evidence used for this PRD:
- `src/worker.ts`
- `src/hermes/gateway.ts`
- `src/hermes/cli.ts`
- `src/hermes/payload.ts`
- `src/domain/store.ts`
- `src/ui/index.tsx`
- `tests/cli.spec.ts`
- `tests/payload.spec.ts`
- `tests/plugin.spec.ts`
- `tests/view-model.spec.ts`
- `scripts/vps-reuse-check.mjs`
- `README.md`
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/integration.md`
- `docs/security.md`
- `docs/vps-reuse.md`
