require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Các model phổ biến — thử lần lượt
const modelsToTest = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-001",
  "gemini-pro",
  "gemini-pro-latest",
  "gemini-1.0-pro",
  "gemini-1.0-pro-latest"
];

async function testModel(modelName) {
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent("Hello!");
    console.log(`✔ MODEL HOẠT ĐỘNG: ${modelName}`);
    console.log("Phản hồi:", result.response.text());
    return true;
  } catch (err) {
    console.log(`❌ Model lỗi: ${modelName}`);
    return false;
  }
}

(async () => {
  console.log("🔍 Đang kiểm tra các model có thể dùng...\n");

  for (const modelName of modelsToTest) {
    await testModel(modelName);
  }

  console.log("\n🔎 Kiểm tra hoàn tất.");
})();
