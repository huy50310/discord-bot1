require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Events 
} = require('discord.js');

const { GoogleGenerativeAI } = require("@google/generative-ai");

// =======================
//  GEMINI AI
// =======================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY_MODEL = "gemini-2.5-flash-lite";   // ưu tiên
const SECOND_MODEL  = "gemini-2.5-flash";        // dự phòng
const FALLBACK_MODEL = "gemini-pro-latest";      // fallback cuối

const userChatHistory = new Map();

// Helper gọi 1 model
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
//  AI HANDLER (TỐI ƯU TỐC ĐỘ + GIỮ CẢM XÚC)
// =======================
async function runGemini(userId, prompt) {
  try {
    if (!userChatHistory.has(userId)) {
      userChatHistory.set(userId, [
        { 
          role: "user", 
          parts: [{ 
            text: "Hãy trả lời thân thiện, giống người thật, có cảm xúc, giữ giọng văn gần gũi." 
          }] 
        }
      ]);
    }

    const history = userChatHistory.get(userId);

    // 🔥 gửi 8 tin gần nhất → tốc độ nhanh
    const slimHistory = history.slice(-8);

    let result;

    // 1️⃣ thử flash-lite
    try {
      console.log("▶ Dùng flash-lite...");
      result = await tryModel(PRIMARY_MODEL, slimHistory, prompt);
      console.log("✔ Thành công flash-lite");
    } catch (err) {
      console.warn("⚠ flash-lite lỗi:", err.message);
    }

    // 2️⃣ nếu flash-lite fail → flash
    if (!result) {
      try {
        console.log("▶ Chuyển sang flash...");
        result = await tryModel(SECOND_MODEL, slimHistory, prompt);
        console.log("✔ Thành công flash");
      } catch (err) {
        console.warn("⚠ flash lỗi:", err.message);
      }
    }

    // 3️⃣ fallback cuối → pro-latest
    if (!result) {
      try {
        console.log("▶ Fallback → pro-latest...");
        result = await tryModel(FALLBACK_MODEL, slimHistory, prompt);
        console.log("✔ Thành công pro-latest");
      } catch (err) {
        console.warn("❌ pro-latest lỗi:", err.message);
        return "❌ Hệ thống AI đang quá tải, thử lại sau nhé!";
      }
    }

    const response = result.response.text();

    // lưu lịch sử
    history.push({ role: "user", parts: [{ text: prompt }] });
    history.push({ role: "model", parts: [{ text: response }] });

    return response;

  } catch (err) {
    console.error("Gemini error:", err);
    return "❌ Bot không thể kết nối AI.";
  }
}


// =======================
//  DISCORD CLIENT
// =======================
const TOKEN = process.env.TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// =======================
//  SLASH COMMANDS
// =======================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has('Administrator');

  if (interaction.commandName === 'ping')
    return interaction.reply({ content: '🏓 Pong!', flags: 64 });

  if (interaction.commandName === 'say') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', flags: 64 });

    const text = interaction.options.getString('text');
    await interaction.channel.send(text);

    return interaction.reply({ content: '✅ Bot đã nói thay bạn.', flags: 64 });
  }

  if (interaction.commandName === 'announce') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', flags: 64 });

    const text = interaction.options.getString('text');
    const channel = interaction.options.getChannel('channel');

    await channel.send(`📢 ${text}`);
    return interaction.reply({ content: `Đã gửi thông báo vào ${channel}.`, flags: 64 });
  }
});

// =======================
//  MESSAGE HANDLER
// =======================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  let content = message.content || "";

  // FIX auto mention + prefix
  if (content.includes(`<@${client.user.id}>`) && content.startsWith(':L')) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  }

  // PREFIX :L
  if (content.startsWith(':L ') || content.startsWith(':l ')) {

    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    await message.delete().catch(() => {});

    if (command === "ping")
      return message.channel.send('🏓 Pong!');

    if (!isAdmin)
      return message.channel.send("❌ Bạn không có quyền admin.");

    if (command === "say") {
      const text = args.join(" ");
      return message.channel.send(text);
    }

    if (command === "announce") {
      const text = args.join(" ");
      return message.channel.send(`📢 **Thông báo:** ${text}`);
    }

    return;
  }

  // BOT MENTION → ADMIN COMMANDS + AI
  const isMentioned = message.mentions.users.has(client.user.id);
  if (isMentioned) {

    let after = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = after.split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    // SHUTDOWN
    if (command === "shutdown") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      await message.reply("🔌 Bot đang tắt...");
      console.log("Bot tắt theo yêu cầu admin.");
      return process.exit(0);
    }

    // BAN
    if (command === "ban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Bạn phải tag người cần ban.");
      if (!member.bannable) return message.reply("❌ Không thể ban.");

      await member.ban({ reason });
      return message.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
    }

    // UNBAN
    if (command === "unban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const userId = args[0];
      if (!userId) return message.reply("⚠ Nhập user ID.");

      await message.guild.bans.remove(userId);
      return message.reply(`♻️ Đã unban ID: **${userId}**`);
    }

    // MUTE
    if (command === "mute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const timeArg = args[1];
      const reason = args.slice(2).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Tag người cần mute.");
      if (!timeArg) return message.reply("⚠ Nhập thời gian. Ví dụ: 10s, 5m, 2h");
      if (!member.moderatable) return message.reply("❌ Không thể mute.");

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
      if (!match) return message.reply("⚠ Sai định dạng 10s, 5m, 2h");

      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      const duration =
        unit === "s" ? value * 1000 :
        unit === "m" ? value * 60000 :
        unit === "h" ? value * 3600000 :
                        value * 86400000;

      await member.timeout(duration, reason);
      return message.reply(`🤐 Mute **${member.user.tag}** trong **${timeArg}**`);
    }

    // UNMUTE
    if (command === "unmute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠ Tag người cần unmute.");

      await member.timeout(null);
      return message.reply(`🔊 Unmute **${member.user.tag}**`);
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
client.login(TOKEN);
