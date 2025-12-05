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
const modelName = "gemini-pro-latest";

const userChatHistory = new Map();

async function runGemini(userId, prompt) {
  try {
    if (!userChatHistory.has(userId)) {
      userChatHistory.set(userId, [
        { role: "user", parts: [{ text: "Hãy trả lời thân thiện, giống người thật." }] }
      ]);
    }

    const history = userChatHistory.get(userId);
    const model = genAI.getGenerativeModel({ model: modelName });
    const chat = model.startChat({ history });

    const result = await chat.sendMessage(prompt);
    const response = result.response.text();

    history.push({ role: "user", parts: [{ text: prompt }] });
    history.push({ role: "model", parts: [{ text: response }] });

    return response;
  } catch (err) {
    console.error("Gemini error:", err);
    return "❌ Bot không thể kết nối Gemini.";
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

  // ======================================
  //  🔥 FIX CÁCH 3: KHÔNG CHO DISCORD ÉP MENTION
  //  Nếu Discord auto chèn mention, nhưng msg có prefix :L → xử lý prefix
  // ======================================
  if (content.includes(`<@${client.user.id}>`) && content.startsWith(':L')) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  }

  // ======================================
  //  PREFIX COMMANDS :L
  // ======================================
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

  // ======================================
  //  MENTION BOT → COMMANDS + GEMINI AI
  // ======================================
  const isMentioned = message.mentions.users.has(client.user.id);
  if (isMentioned) {

    let after = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = after.split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    // ======================
    // 🔥 SHUTDOWN
    // ======================
    if (command === "shutdown") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      await message.reply("🔌 Bot đang tắt...");
      console.log("Admin yêu cầu tắt bot.");
      return process.exit(0);
    }

    // ======================
    // ADMIN COMMANDS
    // ======================

    if (command === "ban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      const member = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Bạn phải tag người cần ban.");
      if (!member.bannable) return message.reply("❌ Không thể ban người này.");

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

    if (command === "unmute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠ Tag người cần unmute.");

      await member.timeout(null);
      return message.reply(`🔊 Đã unmute **${member.user.tag}**`);
    }

    // ======================
    //  GEMINI AI CHAT
    // ======================
    if (after) {
      const reply = await runGemini(message.author.id, after);
      return message.reply(reply);
    }

    return message.reply("🤖 Bạn muốn hỏi gì?");
  }
});

// LOGIN
client.login(TOKEN);

