const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function list() {
  try {
    // Lưu ý: Các bản SDK rất cũ có thể không có hàm listModels,
    // nhưng nếu update rồi thì sẽ chạy được.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log("Đang thử kết nối thử...");
    const result = await model.generateContent("Hello");
    console.log("Kết nối thành công! Model 'gemini-1.5-flash' hoạt động.");
    console.log("Phản hồi:", result.response.text());
  } catch (e) {
    console.log("Lỗi chi tiết:", e.message);
    console.log("--> Gợi ý: Hãy chạy 'npm install @google/generative-ai@latest'");
  }
}
list();
