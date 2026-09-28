# Action Item Extractor

A small internal tool that turns rough meeting notes into persisted, trackable action items. Extraction requires a Groq API key; tests use a mocked provider and make no API calls.

## Quick Start

Prerequisite: Node.js 22 or newer and a free [Groq API key](https://console.groq.com/keys). No database server or Docker is needed.

```bash
npm ci
cp .env.example .env.local
# Put your GROQ_API_KEY in .env.local
npm run db:init
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To run checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

To preview the production build, run `npm run start` after `npm run build`.

`npm run db:init` creates `data/app.db` and tables. The app also initializes the database on first use, so the command is safe to repeat. The database and `.env.local` are excluded from version control. `GROQ_MODEL` defaults to `openai/gpt-oss-20b`, which supports strict JSON schema output.

## Architecture

`UI → POST /notes/extract → Groq adapter → JSON parse + Zod validation → SQLite transaction → UI`

The provider adapter returns the raw model message as a string. The service parses and strictly validates every field before it calls persistence. A malformed or partly valid response saves nothing. A successful transaction saves the original note and every item together. Model-produced description, owner, and due text have no update endpoint; only the separate `completed` workflow field can change through `PATCH /items/:id`.

The schema keeps owner and due text nullable. It does not turn “Friday” into a date without a reliable meeting date, or assign an owner from context alone. An empty action list is valid and still saves the note.

## Reliability and failure handling

- Blank notes and notes over 10,000 characters are rejected before the model call.
- The provider is aborted after 1.5 seconds; a service-level deadline also handles an adapter that ignores cancellation. No retries are attempted, to preserve the latency budget. Network/provider errors return 502, timeout returns 504, invalid model output returns 502, and failed persistence returns 500. The UI retains the pasted notes on failure.
- Each extraction writes one structured server log event with request ID, full note text, raw model message (or `null` when none arrived), latency, result, and failure stage. The browser gets only a safe message and request ID. These logs contain sensitive meeting notes by assignment requirement: treat server logs as sensitive data with restricted access and retention in a real deployment.
- The 1.5-second provider deadline leaves room for validation, a local transaction, and HTTP overhead toward the requested 2-second completion target. Actual latency depends on provider and network conditions; it is measured in logs, not guaranteed in every environment.

## Key decisions

SQLite keeps the unzip-to-running path short and provides a real atomic transaction. This project uses a small SQL schema directly, avoiding a migration tool for two tables. The app uses Groq’s strict JSON schema response format to reduce malformed responses, but still validates the raw output locally because the provider is an external trust boundary. Extracted fields remain immutable as an audit record; completion is separate workflow state. The model prompt treats notes as data and excludes complaints or speculation unless a concrete follow-up is indicated.

## AI usage

AI tooling accelerated implementation, code review, and test design. The trust boundary, failure policy, and data model were deliberately reviewed as engineering decisions. The app itself calls an LLM for extraction.

## Retrospective

### What I would do differently with a full week

Build a small labeled evaluation set from real meeting notes, track prompt/model versions and extraction precision, and measure end-to-end latency across realistic inputs. I would add production log retention and access controls, stronger accessibility and browser tests, and consider a fallback provider only after measuring failure rates and the 2-second budget.

### One decision I'm not fully confident about

The synchronous 1.5-second provider deadline is a tradeoff. It gives the user fast feedback and keeps the flow simple, but can reject useful results on slower networks or longer notes. I chose it because the assignment explicitly asks for extraction under two seconds; with a week I would measure real latency distributions and revisit the threshold or the product requirement.

### One thing I deliberately skipped, and why

I deliberately skipped authentication and multi-user ownership. This internal-tool prototype focuses on extraction reliability; auth would add reviewer setup friction without improving the LLM trust boundary. Before exposing persisted meeting notes in production, I would add authentication and per-user or workspace authorization.
