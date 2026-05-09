import { GoogleGenAI } from '@google/genai';

async function test() {
  console.log("Key:", process.env.GEMINI_API_KEY ? "Set" : "Not Set");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: 'Hello'
    });
    console.log("Success:", res.text.slice(0, 50));
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
  }
}
test();
