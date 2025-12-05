require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Events 
} = require('discord.js');

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ======================
//  GEMINI
// ======================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelName = "gemini-pro-latest";

const userChatHistory = new Map();

async function runGemini(message, question) {
  const userId = message.author.id;

  // 1. Kiểm tra nếu câu hỏi rỗng thì chặn ngay
  if (!question || question.trim().length === 0) {
    return message.reply("❌ Bạn chưa nhập nội dung câu hỏi! Hãy nhập: `:L ask <câu hỏi>`");
  }

  // Khởi tạo bộ nhớ nếu chưa có
  if (!memory[userId]) {
    memory[userId] = [];
  }

  await message.channel.sendTyping();

  try {
    // 2. Lọc sạch lịch sử chat cũ để tránh lỗi "tin nhắn rỗng" còn lưu trong RAM
    // Chỉ giữ lại các tin nhắn có text khác rỗng
    memory[userId] = memory[userId].filter(m => m.parts && m.parts[0] && m.parts[0].text && m.parts[0].text.trim() !== "");

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Hoặc gemini-pro-latest tùy bạn chọn

    const chat = model.startChat({
      history: memory[userId],
      generationConfig: {
        maxOutputTokens: 2000,
      },
    });

    const result = await chat.sendMessage(question);
    const response = await result.response;
    const text = response.text();

    // 3. Chỉ lưu vào bộ nhớ nếu Bot trả lời có nội dung
    if (text && text.trim() !== "") {
        // Lưu câu hỏi của User
        memory[userId].push({ role: "user", parts: [{ text: question }] });
        // Lưu câu trả lời của Bot
        memory[userId].push({ role: "model", parts: [{ text: text }] });
        
        // Giới hạn lịch sử
        if (memory[userId].length > 20) memory[userId].shift();
    }

    return message.reply(text);

  } catch (err) {
    console.error("Gemini error:", err);
    
    // Nếu lỗi 400 (Bad Request), thường do lịch sử bị lỗi -> Xóa lịch sử làm lại
    if (err.message.includes("400") || err.message.includes("data")) {
        memory[userId] = []; // Reset bộ nhớ
        return message.reply("⚠️ Đã xảy ra lỗi dữ liệu hội thoại. Bot đã tự động làm mới phiên chat. Hãy hỏi lại nhé!");
    }

    return message.reply("❌ Bot gặp lỗi kết nối.");
  }
}

// ======================
// DISCORD CLIENT
// ======================
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

// ======================
// SLASH COMMAND HANDLER
// ======================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has('Administrator');

  // /ping
  if (interaction.commandName === 'ping')
    return interaction.reply({ content: '🏓 Pong!', ephemeral: true });

  // /say
  if (interaction.commandName === 'say') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    await interaction.channel.send(text);

    return interaction.reply({ content: '✅ Bot đã nói thay bạn.', ephemeral: true });
  }

  // /announce
  if (interaction.commandName === 'announce') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    const channel = interaction.options.getChannel('channel');

    await channel.send(`📢 ${text}`);
    return interaction.reply({ content: `Đã gửi thông báo vào ${channel}.`, ephemeral: true });
  }

  // ======================
  // ⭐ NEW: /ask (Gemini)
  // ======================
  if (interaction.commandName === "ask") {
    const question = interaction.options.getString("text");

    // tránh lỗi timeout 3s
    await interaction.deferReply();

    const answer = await runGemini(interaction.user.id, question);

    return interaction.editReply(answer);
  }
});

// ======================
// PREFIX + MENTION HANDLER
// ======================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  let content = message.content || "";

  if (content.includes(`<@${client.user.id}>`) && content.startsWith(':L')) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  }

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

  const isMentioned = message.mentions.users.has(client.user.id);
  if (isMentioned) {

    let after = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = after.split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    // shutdown bot
    if (command === "shutdown") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      await message.reply("🔌 Bot đang tắt...");
      console.log("Admin yêu cầu tắt bot.");
      return process.exit(0);
    }

    // ban
    if (command === "ban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const member = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Bạn phải tag người cần ban.");
      if (!member.bannable) return message.reply("❌ Không thể ban người này.");

      await member.ban({ reason });
      return message.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
    }

    // unban
    if (command === "unban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const userId = args[0];
      if (!userId) return message.reply("⚠ Nhập user ID.");

      await message.guild.bans.remove(userId);
      return message.reply(`♻️ Đã unban ID: **${userId}**`);
    }

    // mute
    if (command === "mute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const timeArg = args[1];
      const reason = args.slice(2).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Tag người cần mute.");
      if (!timeArg) return message.reply("⚠ Nhập thời gian. Ví dụ: 10s, 5m, 2h");
      if (!member.moderatable) return message.reply("❌ Không thể mute người này.");

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
      if (!match) return message.reply("⚠ Sai định dạng: 10s, 5m, 2h");

      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      const duration = unit === "s" ? value * 1000 :
                       unit === "m" ? value * 60000 :
                       unit === "h" ? value * 3600000 :
                                     value * 86400000;

      await member.timeout(duration, reason);
      return message.reply(`🤐 Đã mute **${member.user.tag}** trong **${timeArg}**`);
    }

    // unmute
    if (command === "unmute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠ Tag người cần unmute.");

      await member.timeout(null);
      return message.reply(`🔊 Đã unmute **${member.user.tag}**`);
    }

    // Gemini chat (mention)
    if (after) {
      const reply = await runGemini(message.author.id, after);
      return message.reply(reply);
    }

    return message.reply("🤖 Bạn muốn hỏi gì?");
  }
});

client.login(TOKEN);




