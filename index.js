// index.js
require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Events 
} = require('discord.js');

const TOKEN = process.env.TOKEN;

// =========================
// OPENAI (ChatGPT)
// =========================
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Bộ nhớ lưu lịch sử chat theo từng user
const userMemory = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,   // BẮT BUỘC BẬT TRONG DEVELOPER PORTAL
  ],
});

// Bot login
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// ========================
//  SLASH COMMAND HANDLER
// ========================
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
    await channel.send(` ${text}`);
    return interaction.reply({ content: `Đã gửi thông báo vào ${channel}.`, ephemeral: true });
  }
});

// ========================
// PREFIX + MENTION HANDLER
// ========================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content || '';

  // ======== PREFIX :L ========
  if (content.startsWith(':L ') || content.startsWith(':l ')) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    await message.delete().catch(() => {});

    if (command === 'ping')
      return message.channel.send('🏓 Pong!');

    if (!isAdmin)
      return message.channel.send('❌ Bạn không có quyền admin.');

    if (command === 'say') {
      const text = args.join(' ');
      if (text) return message.channel.send(text);
    }

    if (command === 'announce') {
      const text = args.join(' ');
      if (text) return message.channel.send(`📢 **Thông báo:** ${text}`);
    }

    // ========== BAN ==========
    if (command === 'ban') {
      const member = message.mentions.members.first();
      const reason = args.slice(1).join(' ') || 'Không có lý do.';

      if (!member) return message.channel.send('⚠ Bạn phải tag người cần ban.');
      if (!member.bannable) return message.channel.send('❌ Không thể ban người này.');

      try {
        await member.ban({ reason });
        return message.channel.send(`🔨 **Đã ban ${member.user.tag}**\n📝 Lý do: ${reason}`);
      } catch {
        return message.channel.send('❌ Không thể ban (thiếu quyền).');
      }
    }

    // ========== UNBAN ==========
    if (command === 'unban') {
      const userId = args[0];
      if (!userId) return message.channel.send('⚠ Nhập user ID.');

      try {
        await message.guild.bans.remove(userId);
        return message.channel.send(`♻️ **Đã unban ID: ${userId}**`);
      } catch {
        return message.channel.send('❌ Không unban được.');
      }
    }

    // ========== MUTE ==========
    if (command === 'mute') {
      const member = message.mentions.members.first();
      const timeArg = args[1];
      const reason = args.slice(2).join(' ') || 'Không có lý do.';

      if (!member) return message.channel.send('⚠ Tag người cần mute.');
      if (!timeArg) return message.channel.send('⚠ Nhập thời gian: 10s, 5m, 1h...');
      if (!member.moderatable) return message.channel.send('❌ Không thể mute (thiếu quyền).');

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
      if (!match) return message.channel.send('⚠ Sai định dạng.');

      let duration = parseInt(match[1]) * 1000;
      if (match[2] === 'm') duration *= 60;
      if (match[2] === 'h') duration *= 3600;
      if (match[2] === 'd') duration *= 86400;

      await member.timeout(duration, reason);
      return message.channel.send(`🤐 **Muted ${member.user.tag} trong ${timeArg}**`);
    }

    // ========== UNMUTE ==========
    if (command === 'unmute') {
      const member = message.mentions.members.first();
      if (!member) return message.channel.send('⚠ Tag người cần unmute.');

      await member.timeout(null);
      return message.channel.send(`🔊 **Đã unmute ${member.user.tag}**`);
    }

    return;
  }

  // =========================
  // CHATGPT WITH MEMORY
  // =========================

  if (message.mentions.users.has(client.user.id)) {
    const userId = message.author.id;

    const question = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    if (!question.length) return message.reply("Bạn muốn hỏi gì vậy?");

    if (!userMemory[userId]) userMemory[userId] = [];

    userMemory[userId].push({ role: "user", content: question });
    if (userMemory[userId].length > 10) userMemory[userId].shift();

    await message.channel.sendTyping();

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Bạn là trợ lý AI thân thiện." },
          ...userMemory[userId]
        ]
      });

      const reply = completion.choices[0].message.content;
      userMemory[userId].push({ role: "assistant", content: reply });

      return message.reply(reply);

    } catch (err) {
      console.error("OpenAI Error:", err);
      return message.reply("❌ Bot không kết nối được OpenAI.");
    }
  }
});

// Đăng nhập bot
client.login(TOKEN);
