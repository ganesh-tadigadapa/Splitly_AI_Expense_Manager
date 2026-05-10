const express = require("express");
const router = express.Router();
const { GoogleGenAI } = require("@google/genai");

const ALLOWED_CATEGORIES = ["Food", "Lodging", "Transport", "Activities", "Shopping", "General"];

function getGemini() {
  const hasGemini =
    process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_KEY !== "your_gemini_api_key_here";
  if (!hasGemini) return null;
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function stripFences(text) {
  return (text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function safeJSON(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AI returned unparseable response");
  }
}

router.post("/categorize", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || title.trim().length < 2) {
      return res.json({ category: "General" });
    }

    const ai = getGemini();
    if (!ai) return res.json({ category: "General" });

    const prompt = `Classify this expense into ONE of: ${ALLOWED_CATEGORIES.join(", ")}.
Respond with ONLY the category word, nothing else.

Expense: "${title}"`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const raw = (response.text || "").trim().split(/\s|\n/)[0].replace(/[^A-Za-z]/g, "");
    const match = ALLOWED_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
    return res.json({ category: match || "General" });
  } catch (err) {
    console.error("Categorize error:", err.message || err);
    return res.json({ category: "General" });
  }
});

router.post("/parse-expense", async (req, res) => {
  try {
    const { text, members = [], currentUser = "" } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ msg: "text is required" });
    }

    const ai = getGemini();
    if (!ai) {
      return res.status(503).json({
        msg: "GEMINI_API_KEY not configured. Add it to server/.env to enable AI parsing.",
      });
    }

    const prompt = `You parse natural-language expense descriptions into structured JSON for a bill-splitting app.

Group members (use these EXACT names, case-sensitive): ${JSON.stringify(members)}
The current user (use this name when the speaker says "I", "me", "myself"): ${JSON.stringify(currentUser)}

Extract:
- title: short 2-4 word summary
- amount: number, no currency symbol
- category: ONE of exactly these: ${ALLOWED_CATEGORIES.join(", ")}
- paidBy: name of the person who paid (must be from group members; default to current user if unclear)
- splitBetween: array of names from group members who share the cost (must include paidBy if "I paid for me and X")

Match fuzzy/partial names from the input to the closest group member name. Drop any names that don't match.

Respond with ONLY valid JSON, no markdown, no code fences. Example:
{"title":"Pizza dinner","amount":600,"category":"Food","paidBy":"Shiva","splitBetween":["Shiva","Raj","Anu"]}

Input: "${text}"`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    let parsed;
    try {
      parsed = safeJSON(response.text);
    } catch {
      return res.status(422).json({
        msg: "Couldn't extract an expense from that. Try something like: \"I paid 500 for pizza for me and Raj\".",
      });
    }

    const title = typeof parsed.title === "string" ? parsed.title.slice(0, 60) : "";
    const amount = Number(parsed.amount) || 0;
    const category = ALLOWED_CATEGORIES.includes(parsed.category) ? parsed.category : "General";

    const memberSet = new Set(members);
    const paidBy = memberSet.has(parsed.paidBy) ? parsed.paidBy : currentUser;
    const splitBetween = Array.isArray(parsed.splitBetween)
      ? parsed.splitBetween.filter((n) => memberSet.has(n))
      : [];

    if (!title && !amount) {
      return res.status(422).json({
        msg: "That doesn't look like an expense. Try: \"I paid 500 for pizza for me and Raj\".",
      });
    }

    return res.json({ title, amount, category, paidBy, splitBetween });
  } catch (err) {
    console.error("Parse expense error:", err.message || err);
    return res.status(500).json({ msg: "AI is unreachable. Try again in a moment." });
  }
});

module.exports = router;
