# Home Credit LAP Voice Agent

A Node.js demonstration project for the Home Credit Loan Against Property (LAP) qualification assignment. It includes a deterministic conversation engine, a browser-based text demo, a complete system prompt, and automated tests.

> This is a demo qualification assistant, not a lender decision engine or a live calling integration. It does not place phone calls, verify identity against customer records, or issue credit approval. Connect the prompt and appropriate secure tools to a voice platform such as Retell AI or Bolna for actual audio calls and recording links.

## Requirements

- Node.js 18 or newer
- npm

## Setup

```bash
npm install
```

Optionally copy `.env.example` to `.env` and edit the defaults.

## Run

```bash
npm start
```

Open <http://localhost:3000>.

## Tests

```bash
npm test
```

Tests use Node's built-in test runner and require no extra test dependency.

## API

- `GET /api/health` — health check
- `GET /api/system-prompt` — returns `system_prompt.txt`
- `POST /api/session` — creates a new demo conversation
- `POST /api/session/:id/message` — sends `{ "customer_utterance": "..." }`
- `GET /api/session/:id` — returns current state and conversation history

Example:

```bash
curl -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d "{\"customer_name\":\"Priya Sharma\",\"language_to_speak\":\"English\"}"
```

Then send a customer response:

```bash
curl -X POST http://localhost:3000/api/session/SESSION_ID/message \
  -H "Content-Type: application/json" \
  -d "{\"customer_utterance\":\"Yes, this is Priya.\"}"
```

## Conversation rules implemented

1. Customer identity is confirmed before offer details are disclosed.
2. Busy customers can schedule a callback and the demo ends that session.
3. Existing property loan / EMI reduction requests route to a loan-transfer specialist.
4. Seven eligibility fields are captured: property type, ownership, original documents, loan amount, occupation + income mode, property market value, and tenure.
5. Details offered out of order are retained and are not asked again.
6. Agricultural property, unavailable original documents, cash income, or tenure outside 3–15 years disqualify immediately.
7. Requests above ₹75 lakh are explained; the customer can continue with ₹75 lakh or decline.
8. Final handoff only happens after every required field is answered and all criteria pass.
9. The demo supports English and Hindi replies. It is rule-based and is not a speech recognition or generative AI engine.

## Voice-platform submission checklist

1. Create an agent on your selected voice platform.
2. Copy `system_prompt.txt` into the platform's system instructions.
3. Configure the runtime variables described in the prompt and select a professional English or Hindi voice.
4. Test the required scenarios with real conversational utterances.
5. Use the platform's recording/transcript feature to generate a shareable public or evaluator-accessible link.
6. Add the actual recording/log link to your submission. This project cannot generate a genuine call recording or public call URL without a configured voice provider and a real test call.

## Security and privacy

Do not commit `.env`, real customer phone numbers, identity documents, or sensitive call recordings to a public repository. Use test data and follow the voice provider's consent, privacy, and retention requirements.
