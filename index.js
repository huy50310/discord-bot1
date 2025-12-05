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

// Model ưu tiên & fallback
const PRIMARY_MODEL   = "gemini-2.5-flash";       // nhanh nhất
const SECOND_MODEL    = "gemini-2.5-flash-lite";  // dự phòng nhanh
const FALLBACK_MODEL  = "gemini-pro-latest";      // dự phòng cuối

// Lịch sử chat theo user
const userChatHistory = new Map();

// Helper gọi AI
async function tryGenerate(modelName, slimHistory, prompt) {
  const model = genAI.getGenerativeModel({ model: modelName });

  return await model.generateContent({
    contents: [
      ...slimHistory,
      { role: "user", parts: [{ text: prompt }] }
    ]
  });
}

// Main AI handler
async function runGemini(userId, prompt) {
  try {
    // nếu user chưa có history
    if (!userChatHistory.has(userId)) {
      userChatHistory.set(userId, [
        { role: "user", parts: [{ text: "Hãy trả lời thân thiện, ngắn gọn, giống người thật." }] }
      ]);
    }

    // lấy history
    const history = userChatHistory.get(userId);

    // chỉ lấy 8 tin gần nhất để tăng tốc
    const slimHistory = history.slice(-8);

    let result;

    // ============================================
    // 1) Thử 2 lần với gemini-2.5-flash
    // ============================================
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`▶ Thử flash (lần ${attempt})`);
        result = await tryGenerate(PRIMARY_MODEL, slimHistory, prompt);
        console.log("✔ Dùng flash thành công!");
        break;
      } catch (err) {
        console.warn(`⚠ Flash lỗi lần ${attempt}:`, err.message);
      }
    }

    // ============================================
    // 2) Nếu flash vẫn lỗi → thử flash-lite
    // ============================================
    if (!result) {
      try {
        console.log("▶ Chuyển sang flash-lite...");
        result = await tryGenerate(SECOND_MODEL, slimHistory, prompt);
        console.log("✔ Dùng flash-lite thành công!");
      } catch (err) {
        console.warn("⚠ Flash-lite lỗi:", err.message);
      }
    }

    // ============================================
    // 3) Fallback cuối cùng → gemini-pro-latest
    // ============================================
    if (!result) {
      console.log("▶ Fallback → gemini-pro-latest...");
      result = await tryGenerate(FALLBACK_MODEL, slimHistory, prompt);
      console.log("✔ Dùng pro-latest thành công!");
    }

    const response = result.response.text();

    // lưu lại history local
    history.push({ role: "user", parts: [{ text: prompt }] });
    history.push({ role: "model", parts: [{ text: response }] });

    return response;

  } catch (err) {
    console.error("Gemini error:", err);
    return "❌ Bot bị lỗi AI, thử lại sau.";
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

  // FIX prefix bị dính mention
  if (content.includes(`<@${client.user.id}>`) && content.startsWith(':L')) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  }

  // PREFIX COMMANDS :L
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

  // BOT MENTION → AI CHAT
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
      console.log("Bot shutdown bởi admin.");
      return process.exit(0);
    }

    // ADMIN COMMANDS (ban, unban, mute… giữ nguyên)
    if (command === "ban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const member = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Tag người cần ban.");
      if (!member.bannable) return message.reply("❌ Không thể ban.");

      await member.ban({ reason });
      return message.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
    }

    if (command === "unban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const userId = args[0];
      if (!userId) return message.reply("⚠ Nhập user ID.");

      await message.guild.bans.remove(userId);
      return message.reply(`♻️ Đã unban ID: **${userId}**`);
    }

    if (command === "mute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const timeArg = args[1];
      const reason = args.slice(2).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Tag người cần mute.");
      if (!timeArg) return message.reply("⚠ Nhập thời gian: 10s, 5m, 2h");
      if (!member.moderatable) return message.reply("❌ Không thể mute.");

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
      if (!match) return message.reply("⚠ Sai định dạng.");

      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      const duration = unit === "s" ? value * 1000 :
                       unit === "m" ? value * 60000 :
                       unit === "h" ? value * 3600000 :
                       value * 86400000;

      await member.timeout(duration, reason);
      return message.reply(`🤐 Mute **${member.user.tag}** trong **${timeArg}**`);
    }

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
