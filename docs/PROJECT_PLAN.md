# Project Plan

## Who this is for

A criminal defense law firm that currently relies on a mix of tools to run
its practice:

- **Loop/HighLevel** for marketing, leads, and intake.
- **MyCase** for active client and case management.
- **monday.com** for internal tasks and workflows.
- **Dropbox** for document storage.
- **Vonage** for phone calls and SMS.
- **QuickBooks Online** (planned) for billing and accounting.

This spreads a single case across five-plus disconnected systems. The goal
of this project is a single, custom, firm-owned system for everything that
happens **after** a lead becomes a retained client, purpose-built around how
a criminal defense practice actually works — especially discovery.

## What problem we're solving

1. **Fragmentation.** Case notes, tasks, deadlines, calls, and documents
   live in different tools that don't talk to each other.
2. **Generic tools, specific problem.** MyCase and monday.com are general
   practice-management/task tools. They don't understand criminal discovery
   (Bates numbering, tracking re-served productions, comparing what changed
   between productions, or organizing video/audio/photo evidence with
   consistent identifiers).
3. **No unified case timeline.** There's no single place to see everything
   that has happened on a matter — notes, tasks, deadlines, calls, and
   documents together — with a reliable audit trail.
4. **Vendor lock-in and cost.** A custom system, owned by the firm, avoids
   ongoing per-seat SaaS costs for the tools it replaces and can be shaped
   exactly around how the firm works.

## What we're keeping vs. replacing

| Area | Decision | Why |
|---|---|---|
| Leads / intake | Keep Loop/HighLevel | Marketing/intake is a different problem domain; not worth rebuilding. |
| Active case management | **Replace MyCase** | This is the core of this project. |
| Tasks/workflows | Possibly replace monday.com | Native tasks tied directly to matters are simpler than syncing with an external tool. Not required for v1. |
| Document storage | Keep Dropbox | Firm already has a large, organized Dropbox structure and existing habits. We add structure, indexing, and metadata on top rather than migrating files. |
| Phone/SMS | Keep Vonage | Telephony is a solved, regulated problem (call recording, compliance, numbers). We integrate with it rather than replace it. |
| Billing | Keep QuickBooks Online (future) | Billing/accounting is out of scope for this system; we may integrate later. |

## Guiding principles

- **One developer must be able to maintain this.** Every architectural
  decision favors simplicity and boring, well-understood technology over
  cleverness or maximum flexibility.
- **Confidentiality first.** This system will hold privileged
  attorney-client information. Security is designed in from the start, not
  retrofitted.
- **Dropbox stays the file system of record.** This app should never become
  a second, competing place where documents "actually live." It organizes
  and references Dropbox content.
- **Discovery management is a core differentiator**, not an afterthought —
  it's the main reason a generic tool like MyCase falls short for a criminal
  defense practice.
- **Build incrementally.** Ship one working vertical slice (e.g., Clients,
  then Matters, then Tasks) at a time. Avoid building broad, shallow
  scaffolding across the whole app before anything is usable.
- **No real client data until the system is trustworthy.** All development
  and testing uses fictional data until security review and backup/recovery
  are in place.

## Out of scope for now

These are explicitly deferred — see `docs/ROADMAP.md` for sequencing:

- Any live integration with Vonage, Dropbox, Loop/HighLevel, MyCase, or
  QuickBooks Online.
- Billing and accounting features.
- Migrating historical data from MyCase or monday.com.
- A fully built-out UI. The first milestone is a working data model plus a
  thin UI for one entity (clients), end to end.

## Success looks like

- The firm can create/track clients, matters, tasks, deadlines, notes, and
  calendar events without touching MyCase.
- Discovery for a matter can be organized, Bates-numbered, and tracked by
  production in a way that's clearly better than a shared Dropbox folder
  alone.
- Every meaningful action on a case is auditable: who did what, when.
- The system is simple enough that one developer can safely extend it a
  year from now without re-learning the whole codebase.
