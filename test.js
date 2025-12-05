const { GoogleGenerativeAI } = require("@google/generative-ai");
const ai = new GoogleGenerativeAI("AIzaSyBDi4RNYiX8Vw-nuzwlZCXUFMo45nmgqnk"); // thay phần key

async function testFlash() {
  try {
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
    const res = await model.generateContent("ping");
    console.log("FLASH OK:", res.response.text());
  } catch (err) {
    console.log("FLASH ERR:", err.message);
  }
}

testFlash();
