# Phone-call mode

Click **Call client's phone** and the client's real phone rings. Twilio handles the audio
(neural voice for the agent, speech recognition for the client); every turn still runs through
the same reasoning engine as the browser call, and the call screen mirrors the conversation live.
No ElevenLabs account is needed for this.

## How it works

```
Call screen ──POST /api/phone/call──▶ Twilio REST (creates the outbound call)
                                          │
Twilio ──POST /api/phone/twiml (SpeechResult)──▶ our server ──Claude turn──▶ TwiML <Say> + <Gather>
                                          │
Twilio ──POST /api/phone/status──▶ call status (ringing / in-progress / completed)
Call screen ◀──GET /api/phone/state (polled every 1.5 s)── transcript + clarifications
```

Twilio must be able to reach this server, so it needs a public URL.

## Setup (already done on this machine)

`.env.local` contains:

```
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_FROM_NUMBER=+1XXXXXXXXXX          # the Twilio number
DEMO_CLIENT_PHONE=+1XXXXXXXXXX          # the phone that rings (editable on the call screen)
PUBLIC_BASE_URL=https://….trycloudflare.com
```

`cloudflared` is installed (`brew install cloudflared`).

## Trial-account notes (how the call is built to survive them)

- Twilio's trial API accepts only `To`, `From`, `Url` (plus `StatusCallback`) when creating a call; the
  request ladder in `src/lib/phone/twilio.ts` falls back automatically.
- Twilio has been seen cancelling a TwiML fetch after roughly five seconds, so no fetch ever waits on
  the model: the greeting is composed while the phone rings, a client answer gets an instant "Okay.",
  and the reply is collected by short silent post-backs (`?wait=1`). `<Redirect>` is avoided because
  trial calls cap it at ten per call.
- The agent's line is released the moment the model has composed it (streaming); record updates
  finish in the background. Conversation turns run on `BLANKETT_CONVERSE_MODEL` (Sonnet 5, no
  extended thinking) for latency; analysis still uses `BLANKETT_MODEL`.
- Voice: `TWILIO_VOICE` (default `Google.en-US-Chirp3-HD-Aoede`); with `ELEVENLABS_API_KEY` set the
  agent's lines are synthesised by ElevenLabs and played with `<Play>`.
- Quick-tunnel hostnames change every run: `npm run tunnel` now records the new URL in `.env.local`
  itself, and the server prefers the host the app is opened at over a stale `PUBLIC_BASE_URL`.

## Every time you run the demo

1. Start the app: `npm run dev` (port 3111).
2. In a second terminal start the tunnel: `npm run tunnel`. It prints the URL and writes it into
   `.env.local` as `PUBLIC_BASE_URL` (the dev server picks the change up on its own).
3. Issues → **Call their phone**. Answer the phone as the client.

To avoid the changing URL, create a free Cloudflare or ngrok account and use a named/static
tunnel; then set `PUBLIC_BASE_URL` once.

## Tuning

- `TWILIO_VOICE` — any Twilio `<Say>` voice; default `Polly.Joanna-Neural`. Try
  `Polly.Matthew-Neural` or `Google.en-US-Neural2-F`.
- Speech recognition uses Twilio's `experimental_conversations` model with automatic end-of-speech
  detection. Speak naturally; short pauses are fine.
- If the client is silent, the agent asks "Are you still there?"; after three silences it says
  goodbye and hangs up.

## Known limits

- Each turn takes ~3–7 s (speech recognition + reasoning + synthesis); there is a pause after you
  finish speaking. That is normal for a turn-based phone agent.
- Mid-call document upload works from the call screen (the agent reacts on its next turn).
- Trial Twilio accounts can only call verified numbers and play a trial notice first.
- Rotate the Twilio auth token and the Anthropic key after the demo; both were shared in chat.
