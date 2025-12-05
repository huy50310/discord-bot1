// test-models.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==== 🔥 NHẬP API KEY Ở ĐÂY
const API_KEY = "AIzaSyBDi4RNYiX8Vw-nuzwlZCXUFMo45nmgqnk";
// ==========================

const ai = new GoogleGenerativeAI(API_KEY);

// Danh sách tất cả model phổ biến hiện tại
const MODELS = [
  "gemini-3.0",
  "gemini-3.0-pro",
  "gemini-3.0-flash",
  "gemini-3.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  "gemini-1.0-pro",
  "gemini-1.0-pro-latest",
  "gemini-pro",
  "gemini-pro-latest",
];

async function testModel(modelName) {
  try {
    const model = ai.getGenerativeModel({ model: modelName });

    const res = await model.generateContent("ping");
    const text = res.response.text();

    console.log(`✔ MODEL OK: ${modelName} → ${text}`);
  } catch (err) {
    console.log(`❌ MODEL ERROR: ${modelName} → ${err.message}`);
  }
}

(async () => {
  console.log("🔍 Bắt đầu kiểm tra tất cả model...\n");

  for (const m of MODELS) {
    await testModel(m);
  }

  console.log("\n🏁 Hoàn tất kiểm tra!");
})();
