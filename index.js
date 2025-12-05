require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-1.5-pro";

// Nhớ chat theo user
const memory = {};


// ===============================
// DISCORD CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});


// ====================================================
// PREFIX COMMANDS (:L) — INCLUDING ASK (GEMINI CHAT)
// ====================================================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content.trim();
  const isAdmin = message.member.permissions.has("Administrator");

  // -------- PREFIX :L --------
  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // Ai cũng dùng được
    if (command === "ping") {
      return message.channel.send("🏓 Pong!");
    }

    // ASK — CHAT AI
    if (command === "ask") {
      const question = args.join(" ");
      if (!question) return message.reply("❌ Bạn cần nhập câu hỏi. Ví dụ: `:L ask hôm nay trời sao?`");

      return runGemini(message, question);
    }

    // Các lệnh admin
    if (!isAdmin) {
      return message.reply("❌ Bạn không có quyền admin.");
    }

    if (command === "say") {
      return message.channel.send(args.join(" "));
    }

    if (command === "announce") {
      return message.channel.send(`📢 **Thông báo:** ${args.join(" ")}`);
    }

    return;
  }
});


// ====================================================
// ADMIN COMMANDS VIA MENTION
// ====================================================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot) return;

  const isMentioned = message.mentions.users.has(client.user.id);
  const isAdmin = message.member.permissions.has("Administrator");

  if (!isMentioned) return;

  const content = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();

  // Nếu chỉ mention → show menu
  if (!content) {
    return message.reply(
      "🤖 **Menu lệnh:**\n" +
      "🔹 `:L ask <câu hỏi>` — hỏi AI\n" +
      "🔹 Tag bot + câu hỏi — hỏi AI\n" +
      "🔹 `/say`, `/announce`, mute/ban/unban — admin"
    );
  }

  // Admin commands qua mention
  const parts = content.split(/ +/);
  const command = parts.shift()?.toLowerCase();

  if (["say", "announce", "ban", "unban", "mute", "unmute"].includes(command)) {
    if (!isAdmin) return message.reply("❌ Bạn không có quyền.");
  }

  if (command === "say") {
    return message.channel.send(parts.join(" "));
  }

  if (command === "announce") {
    return message.channel.send(`📢 **Thông báo:** ${parts.join(" ")}`);
  }

  if (command === "ban") {
    const member = message.mentions.members.first();
    if (!member) return message.reply("❌ Tag người cần ban.");
    if (!member.bannable) return message.reply("❌ Không thể ban người này.");

    await member.ban({ reason: parts.slice(1).join(" ") || "Không có lý do" });
    return message.reply(`🔨 Đã ban **${member.user.tag}**`);
  }

  if (command === "unban") {
    const id = parts[0];
    if (!id) return message.reply("❌ Nhập user ID.");
    await message.guild.bans.remove(id).catch(() => message.reply("❌ Không thể unban."));
    return message.reply(`♻️ Đã unban ID: ${id}`);
  }

  if (command === "mute") {
    const member = message.mentions.members.first();
    const timeArg = parts[1];
    if (!member) return message.reply("❌ Tag người cần mute.");
    if (!timeArg) return message.reply("❌ Nhập thời gian: 10s / 5m / 1h.");

    const regex = /^(\d+)(s|m|h|d)$/i;
    const match = timeArg.match(regex);
    if (!match) return message.reply("❌ Sai định dạng thời gian.");

    const num = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] * num;

    await member.timeout(ms);
    return message.reply(`🤐 Đã mute **${member.user.tag}** trong ${timeArg}`);
  }

  if (command === "unmute") {
    const member = message.mentions.members.first();
    if (!member) return message.reply("❌ Tag người cần unmute.");
    await member.timeout(null);
    return message.reply(`🔊 Đã unmute **${member.user.tag}**`);
  }

  // Nếu không phải lệnh → dùng AI
  return runGemini(message, content);
});


// ====================================================
// GEMINI CHAT FUNCTION
// ====================================================
async function runGemini(message, question) {
  const userId = message.author.id;

  if (!memory[userId]) memory[userId] = [];

  memory[userId].push({ role: "user", text: question });
  if (memory[userId].length > 10) memory[userId].shift();

  await message.channel.sendTyping();

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME
    });

    const result = await model.generateContent({
      contents: memory[userId].map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }))
    });

    const reply = result.response.text();

    memory[userId].push({ role: "model", text: reply });

    if (memory[userId].length > 10) memory[userId].shift();

    return message.reply(reply);

  } catch (err) {
    console.error("Gemini error:", err);
    return message.reply("❌ Bot không thể kết nối tới Gemini 1.5 Pro.");
  }
}


// ===============================
// LOGIN BOT
// ===============================
client.login(process.env.TOKEN);
