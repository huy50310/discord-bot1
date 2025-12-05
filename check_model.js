require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function main() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    console.log("🔍 Đang lấy danh sách models...\n");

    const result = await genAI.listModels();

    console.log("===== DANH SÁCH MODEL CÓ THỂ DÙNG =====");
    result.models.forEach(m => console.log("➡️", m.name));
    console.log("========================================\n");

  } catch (err) {
    console.error("❌ Lỗi:", err);
  }
}

main();
