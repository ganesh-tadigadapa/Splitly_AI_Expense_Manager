const express = require("express");
const router = express.Router();
const { GoogleGenAI } = require("@google/genai");

const ALLOWED_CATEGORIES = ["Food", "Lodging", "Transport", "Activities", "Shopping", "General"];

router.post("/receipt", async (req, res) => {
  try {
    const { image, mimeType } = req.body;

    if (!image) {
      return res.status(400).json({ msg: "Image is required (base64 string)" });
    }

    const hasGemini =
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== "your_gemini_api_key_here";

    if (!hasGemini) {
      return res.status(503).json({
        msg: "GEMINI_API_KEY not configured. Add it to server/.env to enable receipt scanning.",
      });
    }

    const base64 = image.includes(",") ? image.split(",")[1] : image;
    const detectedMime = mimeType || "image/jpeg";

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `You are a receipt OCR assistant. Look at this receipt image and extract:
- title: a short 2-4 word description (e.g. "Pizza dinner", "Uber ride", "Grocery shopping")
- amount: the FINAL total amount paid as a number (no currency symbol)
- category: ONE of exactly these values: ${ALLOWED_CATEGORIES.join(", ")}
- items: array of {name, price} for individual line items if visible (max 10)

Respond with ONLY valid JSON, no markdown, no code fences. Example:
{"title":"Pizza dinner","amount":850,"category":"Food","items":[{"name":"Margherita","price":450},{"name":"Coke","price":80}]}

If you cannot read the receipt clearly, still return JSON with your best guess and set amount to 0.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: detectedMime, data: base64 } },
            { text: prompt },
          ],
        },
      ],
    });

    let text = (response.text || "").trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(502).json({ msg: "AI returned unparseable response", raw: text });
      }
      parsed = JSON.parse(match[0]);
    }

    const title = typeof parsed.title === "string" ? parsed.title.slice(0, 60) : "";
    const amount = Number(parsed.amount) || 0;
    const category = ALLOWED_CATEGORIES.includes(parsed.category) ? parsed.category : "General";
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .filter((i) => i && typeof i.name === "string")
          .slice(0, 10)
          .map((i) => ({ name: i.name.slice(0, 40), price: Number(i.price) || 0 }))
      : [];

    return res.json({ title, amount, category, items });
  } catch (err) {
    console.error("OCR Error:", err.message || err);
    return res.status(500).json({ msg: "Failed to scan receipt", error: err.message });
  }
});

module.exports = router;
