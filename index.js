require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Events 
} = require('discord.js');

const { GoogleGenerativeAI } = require("@google/generative-ai");

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

    userChatHistory.set(userId, history);

    return response;
  } catch (err) {
    console.error("Gemini error:", err);
    return "❌ Bot không thể kết nối Gemini.";
  }
}

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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has('Administrator');

  if (interaction.commandName === 'ping') {
    return interaction.reply({ content: '🏓 Pong!', ephemeral: true });
  }

  if (interaction.commandName === 'say') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    await interaction.channel.send(text);

    return interaction.reply({ content: '✅ Bot đã nói thay bạn.', ephemeral: true });
  }

  if (interaction.commandName === 'announce') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    const channel = interaction.options.getChannel('channel');

    await channel.send(`📢 ${text}`);

    return interaction.reply({
      content: `Đã gửi thông báo vào ${channel}.`,
      ephemeral: true
    });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content || "";

  if (content.startsWith(':L ') || content.startsWith(':l ')) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    await message.delete().catch(() => {});

    if (command === 'ping') return message.channel.send('🏓 Pong!');

    if (!isAdmin) return message.channel.send('❌ Bạn không có quyền admin.');

    if (command === 'say') {
      const text = args.join(' ');
      return message.channel.send(text);
    }

    if (command === 'announce') {
      const text = args.join(' ');
      return message.channel.send(`📢 **Thông báo:** ${text}`);
    }

    return;
  }

  const isMentioned = message.mentions.users.has(client.user.id);
  
  if (isMentioned) {
    const after = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = after.split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    if (command === "ban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Bạn phải tag người cần ban.");
      if (!member.bannable) return message.reply("❌ Không thể ban người này.");

      try {
        await member.ban({ reason });
        return message.reply(`🔨 Đã ban **${member.user.tag}**\n📝 Lý do: ${reason}`);
      } catch {
        return message.reply("❌ Không thể ban (thiếu quyền hoặc lỗi).");
      }
    }

    if (command === "unban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const userId = args[0];
      if (!userId) return message.reply("⚠ Bạn phải nhập user ID.");

      try {
        await message.guild.bans.remove(userId);
        return message.reply(`♻️ Đã unban ID **${userId}**`);
      } catch {
        return message.reply("❌ Không unban được người này.");
      }
    }

    if (command === "mute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const timeArg = args[1];
      const reason = args.slice(2).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Tag người cần mute.");
      if (!timeArg) return message.reply("⚠ Nhập thời gian mute. Ví dụ: 10s, 5m, 2h, 1d");
      if (!member.moderatable) return message.reply("❌ Không thể mute người này.");

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
      if (!match) return message.reply("⚠ Sai định dạng: 10s, 5m, 2h, 1d");

      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      let duration = 0;
      if (unit === "s") duration = value * 1000;
      if (unit === "m") duration = value * 60000;
      if (unit === "h") duration = value * 3600000;
      if (unit === "d") duration = value * 86400000;

      try {
        await member.timeout(duration, reason);
        return message.reply(`🤐 Đã mute **${member.user.tag}** trong **${timeArg}**\n📝 ${reason}`);
      } catch (err) {
        return message.reply(`❌ Lỗi khi mute: ${err.message}`);
      }
    }

    if (command === "unmute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠ Tag người cần unmute.");
      if (!member.moderatable) return message.reply("❌ Không thể unmute.");

      try {
        await member.timeout(null);
        return message.reply(`🔊 Đã unmute **${member.user.tag}**`);
      } catch (err) {
        return message.reply(`❌ Lỗi khi unmute: ${err.message}`);
      }
    }

    if (after) {
      const reply = await runGemini(message.author.id, after);
      return message.reply(reply);
    }

    return message.reply("🤖 Bạn muốn hỏi gì?");
  }
});


// LOGIN BOT
client.login(TOKEN);
