require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TOKEN = process.env.TOKEN;

// Tạo client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // nhớ bật trong Developer Portal
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// Khi bot login thành công
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// ========================
// SLASH COMMAND HANDLER
// ========================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has("Administrator");

  if (interaction.commandName === "ping") {
    return interaction.reply({ content: "🏓 Pong!", ephemeral: true });
  }

  if (interaction.commandName === "say") {
    if (!isAdmin) return interaction.reply({ content: "❌ Bạn không phải admin.", ephemeral: true });

    const text = interaction.options.getString("text");
    await interaction.channel.send(text);

    return interaction.reply({ content: "✅ Bot đã nói thay bạn.", ephemeral: true });
  }

  if (interaction.commandName === "announce") {
    if (!isAdmin) return interaction.reply({ content: "❌ Bạn không phải admin.", ephemeral: true });

    const text = interaction.options.getString("text");
    const channel = interaction.options.getChannel("channel");

    await channel.send(`${text}`);
    return interaction.reply({ content: `Đã gửi thông báo vào ${channel}`, ephemeral: true });
  }
});

// ========================
// PREFIX COMMANDS :L
// ========================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content || "";
  const isAdmin = message.member.permissions.has("Administrator");

  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    await message.delete().catch(() => {});

    if (command === "ping") {
      return message.channel.send("🏓 Pong!");
    }

    if (!isAdmin) {
      return message.channel.send("❌ Bạn không có quyền admin.");
    }

    if (command === "say") {
      const text = args.join(" ");
      if (text) return message.channel.send(text);
    }

    if (command === "announce") {
      const text = args.join(" ");
      if (text) return message.channel.send(`📢 **Thông báo:** ${text}`);
    }

    return;
  }
});

// =============================
// ADMIN COMMANDS VIA MENTION
// =============================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot) return;

  const isAdmin = message.member.permissions.has("Administrator");
  const content = message.content;

  const isMentioned = message.mentions.users.has(client.user.id)
    && !message.mentions.everyone;

  if (!isMentioned) return;

  const after = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  const args = after.split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (!after) {
    return message.reply(
      "📜 **Menu lệnh:**\n" +
      "🔹 /ping – Kiểm tra bot.\n" +
      "🔹 /say <text> – Bot nói thay bạn (ADMIN).\n" +
      "🔹 /announce <text> – Bot thông báo (ADMIN).\n" +
      "🔹 :L ping / :L say / :L announce.\n" +
      "🔹 Chat AI bằng cách tag bot + câu hỏi."
    );
  }

  // ADMIN COMMANDS
  if (["say", "announce", "ban", "unban", "mute", "unmute"].includes(command)) {
    if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
    await message.delete().catch(() => {});
  }

  if (command === "say") {
    return message.channel.send(args.join(" "));
  }

  if (command === "announce") {
    return message.channel.send(`📢 **Thông báo:** ${args.join(" ")}`);
  }

  if (command === "ban") {
    const member = message.mentions.members.first();
    if (!member) return message.channel.send("⚠ Bạn phải tag người cần ban.");
    if (!member.bannable) return message.channel.send("❌ Không thể ban người này.");

    await member.ban({ reason: args.slice(1).join(" ") || "Không có lý do." });
    return message.channel.send(`🔨 Đã ban **${member.user.tag}**`);
  }

  if (command === "unban") {
    const id = args[0];
    if (!id) return message.channel.send("⚠ Nhập user ID để unban.");

    await message.guild.bans.remove(id).catch(() => {
      return message.channel.send("❌ Không thể unban.");
    });

    return message.channel.send(`♻️ Đã unban ID: ${id}`);
  }

  if (command === "mute") {
    const member = message.mentions.members.first();
    const timeArg = args[1];

    if (!member) return message.channel.send("⚠ Tag người cần mute.");
    if (!timeArg) return message.channel.send("⚠ Nhập thời gian: 10s / 5m / 1h.");
    if (!member.moderatable) return message.channel.send("❌ Không thể mute.");

    const regex = /^(\d+)(s|m|h|d)$/i;
    const match = timeArg.match(regex);
    if (!match) return message.channel.send("⚠ Sai định dạng thời gian.");

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] * value;

    await member.timeout(ms);
    return message.channel.send(`🤐 Đã mute **${member.user.tag}** ${timeArg}`);
  }

  if (command === "unmute") {
    const member = message.mentions.members.first();
    if (!member) return message.channel.send("⚠ Tag người cần unmute.");

    await member.timeout(null);
    return message.channel.send(`🔊 Đã unmute **${member.user.tag}**`);
  }
});

// =============================
// GEMINI AI CHAT WITH MEMORY
// =============================
const memory = {};

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // check mention
  if (!message.mentions.users.has(client.user.id)) return;

  const prompt = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  if (!prompt.length) return message.reply("Bạn muốn hỏi gì?");

  const userId = message.author.id;
  if (!memory[userId]) memory[userId] = [];

  memory[userId].push({ role: "user", text: prompt });
  if (memory[userId].length > 10) memory[userId].shift();

  await message.channel.sendTyping();

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
    console.error(err);
    return message.reply("❌ Bot không thể kết nối Gemini.");
  }
});

// ========== LOGIN ==========
client.login(TOKEN);
