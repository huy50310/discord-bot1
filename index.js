// =========================
//  IMPORT
// =========================
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Discord bot token
const TOKEN = process.env.TOKEN;

// Google Gemini API client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Memory để ghi nhớ chat theo user
const memory = {};


// =========================
//  DISCORD CLIENT
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // phải bật trong Dev Portal
  ],
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});


// =========================
//  SLASH COMMANDS
// =========================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has("Administrator");

  if (interaction.commandName === "ping") {
    return interaction.reply({ content: "🏓 Pong!", ephemeral: true });
  }

  if (interaction.commandName === "say") {
    if (!isAdmin)
      return interaction.reply({ content: "❌ Bạn không phải admin.", ephemeral: true });

    const text = interaction.options.getString("text");
    await interaction.channel.send(text);

    return interaction.reply({
      content: "✅ Bot đã nói thay bạn.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "announce") {
    if (!isAdmin)
      return interaction.reply({ content: "❌ Bạn không phải admin.", ephemeral: true });

    const text = interaction.options.getString("text");
    const channel = interaction.options.getChannel("channel");

    await channel.send(`📢 ${text}`);

    return interaction.reply({
      content: `Đã gửi thông báo vào ${channel}.`,
      ephemeral: true
    });
  }
});


// =========================
//  PREFIX COMMANDS (:L)
// =========================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content || "";
  const isAdmin = message.member.permissions.has("Administrator");

  // ======================
  // PREFIX :L COMMANDS
  // ======================
  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    await message.delete().catch(() => {});

    if (command === "ping")
      return message.channel.send("🏓 Pong!");

    if (!isAdmin)
      return message.channel.send("❌ Bạn không phải admin.");

    if (command === "say") {
      return message.channel.send(args.join(" "));
    }

    if (command === "announce") {
      return message.channel.send(`📢 **Thông báo:** ${args.join(" ")}`);
    }

    return;
  }


  // ======================
  // MENTION COMMANDS (@bot)
  // ======================
  const isMentioned = message.mentions.users.has(client.user.id);
  if (!isMentioned) return;

  const text = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();

  // Nếu chỉ mention -> hiện menu
  if (!text.length) {
    return message.reply(
      "🤖 **Menu lệnh của bot:**\n\n" +
      "🔹 `/ping` – kiểm tra bot\n" +
      "🔹 Chat AI: tag bot rồi nhắn câu hỏi\n" +
      "🔹 `:L say` / `:L announce` – admin dùng"
    );
  }


  // ======================
  //  CHAT AI (GEMINI)
  // ======================
  const userId = message.author.id;

  if (!memory[userId]) memory[userId] = [];

  memory[userId].push({ role: "user", text });

  if (memory[userId].length > 10) memory[userId].shift();

  await message.channel.sendTyping();

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.0-pro-latest"
    });

    const response = await model.generateContent({
      contents: memory[userId].map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }))
    });

    const replyText = response.response.text();
    memory[userId].push({ role: "model", text: replyText });

    return message.reply(replyText);

  } catch (err) {
    console.error("Gemini error:", err);
    return message.reply("❌ Bot không thể kết nối tới Gemini.");
  }
});


// =========================
//  LOGIN
// =========================
client.login(TOKEN);


