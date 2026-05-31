const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../Server/.env") });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("Set GEMINI_API_KEY in Server/.env before listing models.");
}

async function listModels() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body.substring(0, 500)}`);
    }

    const models = await response.json();
    console.log("--- AVAILABLE MODELS ---");
    models.models.forEach(m => {
        console.log(`Name: ${m.name}, Display: ${m.displayName}, Methods: ${(m.supportedGenerationMethods || []).join(', ')}`);
    });
  } catch (error) {
    console.error("LIST_MODELS_ERROR:", error.message);
  }
}

listModels();
