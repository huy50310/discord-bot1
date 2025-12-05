// ===============================
//  LOAD MODULES & CONFIG
// ===============================
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials
} = require("discord.js");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const TOKEN = process.env.TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Bộ nhớ hội thoại theo từng người
const userMemory = {};

// ===============================
//  DISCORD CLIENT
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

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// ===============================
//  DEEPSEEK AI FUNCTION
// ===============================
async function askDeepSeek(question, memoryArr) {
  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          ...memoryArr.map(m => ({
            role: m.role,
            content: m.content
          })),
          {
            role: "user",
            content: question
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("DeepSeek API error:", data);
      return "❌ Bot không thể kết nối DeepSeek.";
    }

    return data.choices[0].message.content;
  } catch (err) {
    console.error("DeepSeek Fetch Error:", err);
    return "❌ Lỗi khi kết nối DeepSeek.";
  }
}

// ===============================
//  SLASH COMMANDS (/)
// ===============================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has("Administrator");

  // /ping
  if (interaction.commandName === "ping") {
    return interaction.reply({ content: "🏓 Pong!", ephemeral: true });
  }

  // /say
  if (interaction.commandName === "say") {
    if (!isAdmin)
      return interaction.reply({ content: "❌ Bạn không phải admin.", ephemeral: true });

    const text = interaction.options.getString("text");
    await interaction.channel.send(text);
    return interaction.reply({ content: "✅ Bot đã nói thay bạn.", ephemeral: true });
  }

  // /announce
  if (interaction.commandName === "announce") {
    if (!isAdmin)
      return interaction.reply({ content: "❌ Bạn không phải admin.", ephemeral: true });

    const text = interaction.options.getString("text");
    const channel = interaction.options.getChannel("channel");

    await channel.send(`📢 **Thông báo:** ${text}`);
    return interaction.reply({
      content: `Đã gửi thông báo vào ${channel}.`,
      ephemeral: true
    });
  }
});

// ===============================
//  TEXT MESSAGE HANDLER
// ===============================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content;
  const isAdmin = message.member.permissions.has("Administrator");

  // ===============================
  // PREFIX :L COMMANDS
  // ===============================
  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    await message.delete().catch(() => {});

    if (command === "ping") return message.channel.send("🏓 Pong!");

    if (!isAdmin)
      return message.channel.send("❌ Bạn không có quyền admin.");

    if (command === "say") {
      return message.channel.send(args.join(" "));
    }

    if (command === "announce") {
      return message.channel.send("📢 **Thông báo:** " + args.join(" "));
    }
  }

  // ===============================
  // MENTION BOT → CHAT AI
  // ===============================
  if (message.mentions.users.has(client.user.id)) {
    const userId = message.author.id;
    const question = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();

    if (!question.length)
      return message.reply("Bạn muốn hỏi gì vậy?");

    // tạo bộ nhớ nếu chưa có
    if (!userMemory[userId]) userMemory[userId] = [];

    // lưu câu hỏi
    userMemory[userId].push({ role: "user", content: question });

    // chỉ giữ 10 tin nhắn gần nhất
    if (userMemory[userId].length > 10) userMemory[userId].shift();

    await message.channel.sendTyping();

    const answer = await askDeepSeek(question, userMemory[userId]);

    // lưu trả lời
    userMemory[userId].push({ role: "assistant", content: answer });

    return message.reply(answer);
  }
});

// ===============================
//  LOGIN BOT
// ===============================
client.login(TOKEN);
