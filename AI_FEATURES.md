# AI Features — SmartSplit

This app is a group bill-splitting tool with four AI-powered features built on top of **Google Gemini 2.5 Flash** (text + vision). Below is what each feature does, how it works, and where to find the code.

---

## 1. Receipt OCR (Vision)

**What it does:** User uploads a photo of a receipt → the form auto-fills with title, total amount, category, and a list of itemized line items.

**AI concept:** Multimodal **Vision-Language Model (VLM)**. The receipt image is sent to Gemini along with a structured prompt asking the model to read the image and respond in JSON.

**Flow:**
1. User taps **📷 Scan receipt** in the Add Expense modal.
2. Frontend reads the image, base64-encodes it.
3. `POST /api/ocr/receipt` sends `{ image, mimeType }` to the backend.
4. Backend forwards the image + a JSON-only prompt to Gemini Vision.
5. Backend strips markdown fences, parses JSON, validates the category against an allow-list, and returns clean fields.
6. Frontend fills the form.

**Files:**
- Backend: `server/routes/ocrRoutes.js`
- Frontend: `client/src/components/AddExpenseModal.js` → `handleReceiptUpload()`

**Why it's interesting (viva talking point):** Demonstrates how a single foundation model replaces what would historically need OCR (e.g. Tesseract) + a separate NLP layer for entity extraction.

---

## 2. Natural-Language Expense Entry

**What it does:** Type something like *"I paid 600 for pizza for me, Raj and Anu"* in the AI Quick Entry box → form auto-fills with title, amount, category, who paid, and who's in the split.

**AI concept:** **Structured information extraction** with constrained output. The prompt restricts the model to a fixed JSON schema and a closed set of category values. Member names are also constrained — the prompt receives the actual group member list, and any name the model returns that isn't in that list is dropped server-side.

**Flow:**
1. User types into the Quick Entry input → presses **Parse**.
2. `POST /api/ai/parse-expense` with `{ text, members, currentUser }`.
3. Gemini receives a prompt with the schema, the member list, and the user's text.
4. Backend safely parses the JSON (handles markdown fences, malformed output).
5. Backend filters returned names to ones that actually exist in the group, defaults `paidBy` to `currentUser` if unclear.
6. Frontend fills all fields including the multi-select split.

**Files:**
- Backend: `server/routes/aiRoutes.js` → `/parse-expense`
- Frontend: `client/src/components/AddExpenseModal.js` → `handleNlParse()`

**Why it's interesting:** Combines NLP intent extraction + entity-linking (matching names to known group members) + safe parsing of LLM output.

---

## 3. Auto-Categorize (Debounced Classification)

**What it does:** As the user types the expense title, the category dropdown updates itself (e.g. "Uber to airport" → Transport).

**AI concept:** **Zero-shot text classification** — Gemini is given the title and a closed list of allowed categories, and asked to pick one. No training data needed.

**Flow:**
1. User types in the title field.
2. A 700ms debounce fires after typing stops.
3. `POST /api/ai/categorize` with `{ title }`.
4. Gemini returns just the category word.
5. Backend validates against the allow-list (`Food, Lodging, Transport, Activities, Shopping, General`); if the model says anything else, defaults to `General`.
6. Frontend updates the dropdown — but **only if the user hasn't manually changed it**, so the AI never overrides a deliberate choice.

**Files:**
- Backend: `server/routes/aiRoutes.js` → `/categorize`
- Frontend: `client/src/components/AddExpenseModal.js` (the `useEffect` watching `title`)

**Why it's interesting:** Shows a UX pattern where AI augments without overriding — `categoryTouchedRef` tracks user intent so AI suggestions yield to manual input.

---

## 4. SmartSplit Chatbot (RAG-style Context Injection)

**What it does:** A floating chat widget that answers questions about the current group's expenses ("Who spent the most?", "What's the total?", "How much do I owe Raj?").

**AI concept:** **Retrieval-Augmented Generation (RAG), simple form.** Instead of relying on the model's general knowledge, the backend fetches the group's actual expense data from MongoDB at query time, formats it into a textual context, and prepends it to the system prompt. The model answers grounded in real, current data.

**Flow:**
1. User opens the 🤖 widget and asks a question.
2. `POST /api/chat` with `{ message, groupId }`.
3. Backend queries MongoDB for all expenses in that group.
4. Backend builds a context block ("Here are the recent expenses…") with explicit ₹ INR currency.
5. System prompt + context + user message → Gemini.
6. Reply is rendered in the chat window.

**Bonus features:**
- **Currency control:** the system prompt forbids `$`, ensuring all monetary answers are in ₹ (Indian Rupees) regardless of the model's defaults.
- **Graceful fallback:** if the API key is missing or quota is exhausted, the backend falls back to a deterministic offline reply (e.g. computing totals locally without AI).
- **Provider flexibility:** code supports Gemini (default), OpenAI, and Groq — selected by which API key is set.

**Files:**
- Backend: `server/routes/chatRoutes.js`
- Frontend: `client/src/components/Chatbot.js`

**Why it's interesting:** Classic RAG pattern in miniature — fetch authoritative data, inject as context, let the LLM do the language part.

---

## Tech Stack

| Layer        | Technology                              |
|--------------|------------------------------------------|
| AI provider  | Google Gemini 2.5 Flash (text + vision) |
| Backend      | Node.js, Express 5, Mongoose            |
| Database     | MongoDB (Atlas)                         |
| Frontend     | React 19, Axios                         |
| Auth         | JWT, bcryptjs                           |

---

## Setup

```bash
# 1. Unzip
unzip Ai_splitsystem.zip
cd Ai_splitsystem

# 2. Backend
cd server
npm install
npm start          # listens on :5000

# 3. Frontend (new terminal)
cd ../client
npm install
npm start          # listens on :3000
```

The `.env` (in `server/`) ships with a Gemini API key and a MongoDB Atlas connection string.

---

## Demo Script (for viva)

1. **Sign up** → create a group (`Goa trip`) with members.
2. **Receipt OCR demo:** Click *Add expense* → *Scan receipt* → upload any restaurant bill photo → form fills itself. *"This used Gemini's vision capability to extract structured data from an image."*
3. **NL entry demo:** In the same modal, type *"I paid 1200 for cabs for me and Raj"* → click Parse → form fills. *"Constrained JSON extraction — the model is forced to pick from our member list and category list."*
4. **Auto-categorize demo:** Manually type *"Movie tickets"* in the title → watch the category flip to *Activities*. *"Zero-shot classification with debouncing."*
5. **Chatbot demo:** Open the 🤖 widget. Ask *"Who paid the most?"* and *"What's our total?"* *"This is RAG — we pull real data from MongoDB and inject it into the prompt before the LLM answers."*
6. **Show graceful failure:** Mention what happens when the API key is missing — the offline fallback handles common queries deterministically.

---

## Limitations & Honest Caveats

- The model can hallucinate — that's why every output is validated against an allow-list (categories) or known set (members).
- OCR accuracy depends on photo quality; the prompt asks the model to set `amount: 0` if unreadable rather than guess.
- The chatbot's context is the full group expense list — for very large groups this would need pagination/summarization.
- All AI calls go to Google's API — needs internet + a valid `GEMINI_API_KEY`.
