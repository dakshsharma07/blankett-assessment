# Blankett Resolve

An AI case-resolution agent for immigration workflows. One loop, end to end:

```
CASE DOCUMENTS → CROSS-DOCUMENT ISSUE DETECTION → LIVE CLIENT CALL (BROWSER OR PHONE)
→ STRUCTURED CORRECTIONS → CASE-RECORD REDLINE → ATTORNEY SIGN-OFF
```

> Finding inconsistencies is useful. Closing the loop on them is the product.

All case data is fictional. The sample matter belongs to **Sharma LLP**, an invented firm, and its attorney **Daksh Sharma** is a fictional character played by the author — not a licensed attorney; nothing here is legal advice. Nothing here assesses credibility, eligibility or approval; sign-off records the attorney's decision and never files or submits anything.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3111. `.env.local` holds the configuration (see `.env.example`); the dev server picks up changes to it without a restart.

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Analysis, the conversation and the correction package run on Claude. Without it a rule-based engine handles the bundled sample case only (`BLANKETT_FORCE_DEMO=1` forces this even with a key). |
| `BLANKETT_MODEL` | Analysis and package model (default `claude-opus-5`). |
| `BLANKETT_ANALYSIS_FAST=on` | Try Opus fast mode for analysis (research preview; needs an account with fast-mode access — otherwise it falls back to standard speed on the first request). |
| `BLANKETT_CONVERSE_MODEL`, `BLANKETT_CONVERSE_THINKING=off` | Conversation turns are latency-critical; the demo runs them on `claude-sonnet-5` without extended thinking (about 3–4 s to a spoken reply, versus 7 s+ on Opus). Remove both lines to use the analysis model. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | The agent's voice, in the browser and on the phone. Key permissions needed: Text to Speech, Voices: Read, Speech to Text. Without Voices: Read a fixed premade voice is used; without Speech to Text the browser call transcribes with the device's own recognition. Default voice: Bella (`hpp4J3VqNfWAUOO0d1Us`). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `DEMO_CLIENT_PHONE` | Real phone calls (see below). |
| `PUBLIC_BASE_URL` | Public address Twilio calls back to. `npm run tunnel` writes it for you. |
| `TWILIO_VOICE` | Twilio voice used on the phone when ElevenLabs is not configured (default `Google.en-US-Chirp3-HD-Aoede`). |

The interface never names a model or an engine: the same screens run in either mode.

## Walkthrough

1. **Open a case file** — drop the documents in, or open the *Patel, Maya* matter from the Matters list (same upload and extraction path). PDFs and DOCX are parsed in memory; originals are never modified. Analysis runs as three parallel requests (facts, issues and plan, completeness) and takes about 50 s on the sample case; every issue cites the verbatim passages that caused it.
2. **Issues** — the case opens with a caption block: the matter, attorney, employer, and counts of issues, evidence gaps and affected fields. Each issue shows why it was flagged, what needs to be settled, the source passages (click a file name to see the passage highlighted in the document), the downstream fields it changes, and *On the call*: the objective, the opening question and the fallback if the client is unsure. Four issues appear for the sample case: an employment-timeline conflict (with a possible explanation found in the employer letter), a four-month address gap, an omitted UK trip, and a low-severity job-title mismatch the attorney can settle from the file. The *On the call* tab is the agenda: the attorney can reorder it, remove items, or add a question of their own before dialing.
3. **Resolution plan** — the agent's ordered plan for closing every issue, with a second-order follow-up for each (how the contractor period was paid; whether the move was reported), and every field that will change across the DS-160, the intake questionnaire and the case record.
4. **Completeness** — what a complete H‑1B consular file should contain, judged present / missing / unclear against the upload. Gaps the client can speak to are raised at the end of the call; the rest become the attorney's evidence-to-collect list.
5. **Call the client** — one click starts the voice session; there is no pre-call screen. The agent opens with a short, friendly greeting on behalf of the attorney ("Hi, is this Maya? I'm calling on behalf of Daksh Sharma at Sharma LLP — I have a few quick questions about your H-1B file, if you have a couple of minutes?") and only starts on the issues once the client says it is a good time. It speaks, listens and adapts to what you say as the client (you can also type). An **Agent reasoning** panel shows, for every turn, what the client said, which document it was checked against, what was concluded and why the next question follows — the model produces this trace as part of its structured output, so it is the real basis for the turn, not a narration added afterwards. Every transcript turn keeps it under *Why the agent said this*. Try: *"I was contracting first"*, *"I was staying with my cousin in Atlanta"*, *"honestly I'm not sure"*, or deny the trip and hear the agent cite the passport stamp.
6. **Call their phone** — the second button on the Issues page dials the client's real number; the same agent runs the call and the screen mirrors it live.
7. **Correction package** — end the call to generate it: for each issue, existing evidence / client clarification / proposed resolution, with rationale and source passages. Unresolved items stay unresolved.
8. **Case record redline** — every affected field, before → after, grouped by document, tied to the correction it came from.
9. **Sign off** — accept, edit or reject each item, attest, sign your name and approve. A summary email for the reviewing attorney is drafted from the same package.

## Phone-call mode

Built on Twilio Programmable Voice and designed to run on a **trial account** — full details in [docs/PHONE_CALL_SETUP.md](docs/PHONE_CALL_SETUP.md).

```bash
npm run tunnel      # second terminal: starts cloudflared and records the URL in .env.local
```

Then Issues → **Call their phone**. What makes the call hold up:

- **No fetch ever waits on the model.** Twilio cancels a TwiML fetch after a few seconds, so the greeting is composed while the phone is still ringing, the client's answer gets an instant "Okay." in the agent's own voice, and the reply is collected by short silent post-backs. `<Redirect>` is avoided (trial calls cap it at ten per call) and every callback URL is absolute.
- **The line is released the moment it is composed.** The model's output is streamed and the speech goes out as soon as that field closes; the structured record updates finish in the background. Combined with the faster conversation model, a reply is on the line about 3–4 s after the client stops talking.
- **Nobody gets cut off.** The agent's line plays in full before listening starts, and the client's turn ends after a fixed second of silence rather than Twilio's aggressive automatic end-pointing.
- **Natural voice.** With ElevenLabs configured every line is synthesised (fast model, narrowband audio) and played with `<Play>`; otherwise a generative Twilio voice is used.
- **Survives the trial's API limits.** Call creation falls back to the parameter set the trial accepts, and call status is polled when status callbacks are unavailable.

Trial limits to remember: only verified numbers, 10 minutes per call, 75 minutes total, and a Twilio notice before the call connects.

## Deploying

The browser experience deploys as an ordinary Next.js app (Vercel works; the route handlers declare `maxDuration` up to 300 s, which analysis needs). Two things to know:

- **Gate it.** There is no authentication, and every upload is a minute of model time on your key. Set `BLANKETT_ACCESS_KEY` and share the link as `https://<host>/?key=<value>`; the first visit sets a thirty-day cookie and the key is dropped from the address. Without a cookie, pages show a locked notice and API routes return 401. Twilio's callbacks (`/api/phone/twiml`, `/status`, `/audio`) stay open, since they carry no cookie.
- **Phone mode needs one long-lived process.** Call sessions are held in memory, so a serverless deployment loses them between callbacks; the phone button only appears when Twilio is configured, so leave those variables unset on Vercel and demonstrate phone mode locally (or on a single-instance host with `PUBLIC_BASE_URL` set to it).

Environment for a Vercel deploy: `ANTHROPIC_API_KEY`, `BLANKETT_CONVERSE_MODEL=claude-sonnet-5`, `BLANKETT_CONVERSE_THINKING=off`, `BLANKETT_ACCESS_KEY`, and optionally `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` for the natural voice.

## Sample case

Maya Patel · H-1B consular processing · matter SL-2024-0417 at Sharma LLP (responsible attorney: Daksh Sharma — fictional, see above).

The documents are laid out the way the real paperwork is laid out, not written for the analyzer: a CEAC-style DS-160 printout with section bars and a barcode, a one-page resume, a letter on company letterhead with a signature and a cc: line, a firm travel worksheet prepared from passport review, and a firm intake form with header, footer and page numbers. The inconsistencies sit inside ordinary content, which is what the system has to cope with in practice.

| File | What it contributes |
| --- | --- |
| `DS-160_Application_Summary_Maya_Patel.pdf` | Employment start March 1, 2024; address history with a Jan–Apr 2024 gap; countries visited: Canada, India |
| `Resume_Maya_Patel.pdf` | Northstar Systems LLC, Software Engineer II, from January 15, 2024 |
| `Employment_Verification_Letter_Northstar.pdf` | Contractor from Jan 15, full-time from Mar 1 — the explanation |
| `Travel_History_Record_Maya_Patel.pdf` | A UK trip (Feb 14–21, 2024) with stamp detail, absent from the DS-160 |
| `Client_Intake_Questionnaire_Maya_Patel.docx` | Client's own answers: "no other addresses", only Canada and India |

Regenerate the documents with `npm run docs:generate` (pdfkit + docx; uses the system's Georgia / Times New Roman / Arial when present, PDFKit's built-in fonts otherwise). Run the no-key pipeline end to end from the terminal with `npm run smoke`.

Live AI mode handles any documents you upload — the sample case is a starting point, not a requirement. Drop in your own resume, a real DS-160 printout or an employer letter and the analysis, the call and the correction package are built from whatever is there.

## Design

The interface is built to read like a case file, not a dashboard: Libre Caslon Text for headings, client names and quoted evidence (the typeface of American founding legal documents), Public Sans for the interface (the U.S. Web Design System face used on the government forms in the file), a bond-paper ground, Oxford blue for the firm, and oxblood used only as redline ink. Every case page opens with a legal caption block closed by a double rule; verbatim passages are set as quoted matter; the sign-off is a signature block.

## How it is built

- **Next.js 16 / React 19 / Tailwind 4**, state in a persisted zustand store (browser only — no database).
- **Document ingestion**: `unpdf` for PDFs, `mammoth` for DOCX, via `POST /api/parse` (multipart).
- **Analysis** (`/api/analyze`): Claude with structured output (`zodOutputFormat`) returns facts, issues, a resolution plan (order, opening question, fallback, helpful documents, affected fields) and an evidence checklist, with `docName + section + quote` evidence; every quote is re-located in the extracted text and marked verified/unverified (shield icon).
- **Conversation** (`/api/converse`, `src/lib/ai/converse.ts`): each turn sends the resolution plan and evidence (cached system prompt), the transcript, the current clarification record and any document the client just sent; the model returns reasoning, `focusIssueId`, `endCall`, `speech` and structured `updates`, in that order so the phone path can release the speech early via a streaming variant.
- **Phone** (`src/lib/phone/`, `/api/phone/*`): call creation and TwiML generation against Twilio's REST API (no SDK), in-memory call sessions, one conversational turn per client utterance through the same engine, ElevenLabs clips served to Twilio from `/api/phone/audio`, and a state endpoint the screen polls.
- **Package** (`/api/package`): Claude turns issues + clarifications + transcript (+ documents received during the call) into before / clarification / resolution corrections, field-level record changes for the redline, an evidence-to-collect list and the attorney email.
- **Sign-off**: purely client-side review state; approval never mutates documents or claims any external action.

## Not in scope

Authentication, persistence beyond the browser, email delivery, OCR of scanned images, multi-case views.
