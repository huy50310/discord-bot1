require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-pro-latest"; // Model hợp lệ

// Lưu lịch sử chat của từng user
const memory = {};


// ===============================
// DISCORD CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});


// ===============================
// PREFIX COMMANDS :L ask
// ===============================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.inGuild()) return;

  const content = message.content.trim();

  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (command === "ask") {
      const question = args.join(" ");
      if (!question) return message.reply("❌ Bạn chưa nhập câu hỏi!");

      return runGemini(message, question);
    }
  }
});


// ===============================
// @mention → AI trả lời
// ===============================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.inGuild()) return;

  const isMentioned = message.mentions.users.has(client.user.id);
  if (!isMentioned) return;

  const question = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  if (!question) return message.reply("Bạn muốn hỏi gì?");

  return runGemini(message, question);
});


// ===============================
// GEMINI CHAT FUNCTION v1 FIXED
// ===============================
async function runGemini(message, question) {
  const userId = message.author.id;

  if (!memory[userId]) memory[userId] = [];

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const chat = model.startChat({
      history: memory[userId].map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }))
    });

    const result = await chat.sendMessage(question);
    const replyText = result.response.text();

    memory[userId].push({ role: "user", text: question });
    memory[userId].push({ role: "model", text: replyText });

    if (memory[userId].length > 10) memory[userId].shift();

    return message.reply(replyText);

  } catch (err) {
    console.error("Gemini error:", err);
    return message.reply("❌ Không kết nối được Gemini API.");
  }
}


// ------------------------------
// LOGIN BOT
// ------------------------------
client.login(process.env.TOKEN);





