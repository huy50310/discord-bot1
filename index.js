require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// =======================
//  GEMINI AI
// =======================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY_MODEL = "gemini-2.5-flash-lite";
const SECOND_MODEL  = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-pro-latest";

const userChatHistory = new Map();

async function tryModel(modelName, history, prompt) {
  const model = genAI.getGenerativeModel({ model: modelName });

  return await model.generateContent({
    contents: [
      ...history,
      { role: "user", parts: [{ text: prompt }] }
    ]
  });
}

// =======================
//  AI HANDLER
// =======================
async function runGemini(userId, prompt) {
  try {
    if (!userChatHistory.has(userId)) {
      userChatHistory.set(userId, [
        { 
          role: "user", 
          parts: [{ text: "Hãy trả lời thân thiện, giống người thật." }] 
        }
      ]);
    }

    const history = userChatHistory.get(userId);
    const slimHistory = history.slice(-8);
    let result;

    try {
      result = await tryModel(PRIMARY_MODEL, slimHistory, prompt);
    } catch {}

    if (!result) {
      try {
        result = await tryModel(SECOND_MODEL, slimHistory, prompt);
      } catch {}
    }

    if (!result) {
      try {
        result = await tryModel(FALLBACK_MODEL, slimHistory, prompt);
      } catch {
        return "❌ AI đang quá tải, thử lại sau nhé!";
      }
    }

    const response = result.response.text();

    history.push({ role: "user", parts: [{ text: prompt }] });
    history.push({ role: "model", parts: [{ text: response }] });

    return response;

  } catch (err) {
    console.error("Gemini error:", err);
    return "❌ Lỗi AI rồi!";
  }
}

// =======================
//  DISCORD CLIENT
// =======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// =======================
//  BOT STATUS (XOAY VÒNG)
// =======================
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot Online: ${c.user.tag}`);

  const statuses = [
    "chúc bạn một ngày tốt lành ☀️",
    "nghỉ ngơi giữa trưa 😌",
    "ở đây với bạn 🌙",
    "thức khuya cùng bạn 😴",
    "tâm sự cùng bạn 💬"
  ];

  setInterval(() => {
    client.user.setPresence({
      status: "online",
      activities: [
        {
          name: statuses[Math.floor(Math.random() * statuses.length)],
          type: 4
        }
      ]
    });
  }, 300000); // 5 phút
});

// =======================
//  MESSAGE HANDLER
// =======================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  let content = message.content || "";
  const isMentioned = message.mentions.users.has(client.user.id);
  const isAdmin = message.member.permissions.has('Administrator');

  // =====================
  //   ADMIN LÚC MENTION
  // =====================
  if (isMentioned) {
    const after = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = after.split(/ +/);
    const command = args.shift()?.toLowerCase();

    // SHUTDOWN
    if (command === "shutdown") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      await message.reply("🔌 Bot đang tắt…");
      return process.exit(0);
    }

    // BAN
    if (command === "ban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠ Tag người cần ban.");
      const reason = args.slice(1).join(" ") || "Không có lý do.";
      await member.ban({ reason });
      return message.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
    }

    // UNBAN
    if (command === "unban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const userId = args[0];
      if (!userId) return message.reply("⚠ Nhập user ID.");
      await message.guild.bans.remove(userId);
      return message.reply(`♻️ Đã unban **${userId}**`);
    }

    // MUTE
    if (command === "mute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const member = message.mentions.members.first();
      const timeArg = args[1];
      if (!member) return message.reply("⚠ Tag người cần mute.");
      if (!timeArg) return message.reply("⚠ Nhập thời gian: 10s, 5m, 2h");
      
      const match = timeArg.match(/^(\d+)(s|m|h)$/i);
      if (!match) return message.reply("⚠ Sai định dạng!");
      const value = parseInt(match[1]);
      const unit = match[2];
      const duration =
        unit === "s" ? value * 1000 :
        unit === "m" ? value * 60000 :
                       value * 3600000;

      await member.timeout(duration);
      return message.reply(`🤐 Đã mute **${member.user.tag}** trong ${timeArg}`);
    }

    // UNMUTE
    if (command === "unmute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠ Tag người cần unmute.");
      await member.timeout(null);
      return message.reply(`🔊 Đã unmute **${member.user.tag}**`);
    }

    // AI CHAT
    if (after) {
      const reply = await runGemini(message.author.id, after);
      return message.reply(reply);
    }

    return message.reply("🤖 Bạn muốn hỏi gì?");
  }
});

// LOGIN
client.login(process.env.TOKEN);
