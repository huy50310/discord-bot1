// index.js
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events
} = require('discord.js');

// =========================
//  DISCORD TOKEN
// =========================
const TOKEN = process.env.TOKEN;

// =========================
//  TẠO CLIENT DISCORD
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // ĐÃ BẬT INTENT — nhớ bật trong Developer Portal
  ],
});

// Khi bot online
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// =========================
//  SLASH COMMAND HANDLER
// =========================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has('Administrator');

  // /ping
  if (interaction.commandName === 'ping') {
    return interaction.reply({
      content: '🏓 Pong!',
      ephemeral: true
    });
  }

  // /say
  if (interaction.commandName === 'say') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    await interaction.channel.send(text);

    return interaction.reply({
      content: '✅ Bot đã nói thay bạn.',
      ephemeral: true
    });
  }

  // /announce
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

// =========================
//  PREFIX COMMANDS (:L)
// =========================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content;
  const isAdmin = message.member.permissions.has('Administrator');

  // PREFIX: :L
  if (content.startsWith(':L ') || content.startsWith(':l ')) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    await message.delete().catch(() => {});

    if (command === 'ping')
      return message.channel.send('🏓 Pong!');

    if (!isAdmin)
      return message.channel.send('❌ Bạn không có quyền admin.');

    if (command === 'say')
      return message.channel.send(args.join(' '));

    if (command === 'announce')
      return message.channel.send(`📢 **Thông báo:** ${args.join(' ')}`);

    return;
  }

  // =========================
  // BAN / UNBAN / MUTE / UNMUTE
  // =========================

  const isMentionBot = message.mentions.users.has(client.user.id);

  // Nếu message chỉ là mention → hiện menu
  if (isMentionBot && message.content.trim() === `<@${client.user.id}>`) {
    return message.reply(
      [
        '📜 **Menu lệnh của bot:**\n',
        '🔹 **Slash Commands (/):**',
        '• `/ping` – Kiểm tra bot hoạt động.',
        '• `/say <text>` – Bot nói thay bạn (ADMIN).',
        '• `/announce <text> <channel>` – Bot gửi thông báo (ADMIN).',
        '',
        '🔹 **Prefix Commands (:L):**',
        '• `:L ping`',
        '• `:L say <text>`',
        '• `:L announce <text>`',
      ].join('\n')
    );
  }

  // Nếu bot bị mention → tiếp tục xử lý lệnh hoặc chatbot
  if (isMentionBot) {
    const cleanMsg = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    const args = cleanMsg.split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (['ban', 'unban', 'mute', 'unmute', 'say', 'announce'].includes(command))
      await message.delete().catch(() => {});

    if (command === 'ping')
      return message.channel.send('🏓 Pong!');

    if (command === 'ban') {
      if (!isAdmin) return message.channel.send('❌ Bạn không phải admin.');
      const member = message.mentions.members.first();
      const reason = args.slice(1).join(' ') || 'Không có lý do.';
      if (!member) return message.channel.send('⚠ Bạn phải tag người cần ban.');
      if (!member.bannable) return message.channel.send('❌ Không thể ban người này.');
      await member.ban({ reason });
      return message.channel.send(`🔨 **Bot đã ban ${member.user.tag}**\n📝 Lý do: ${reason}`);
    }

    if (command === 'unban') {
      if (!isAdmin) return message.channel.send('❌ Bạn không phải admin.');
      const userId = args[0];
      if (!userId) return message.channel.send('⚠ Bạn phải nhập user ID.');
      await message.guild.bans.remove(userId);
      return message.channel.send(`♻️ **Bot đã unban người dùng ID: ${userId}**`);
    }

    if (command === 'mute') {
      if (!isAdmin) return message.channel.send('❌ Bạn không phải admin.');
      const member = message.mentions.members.first();
      const timeArg = args[1];
      const reason = args.slice(2).join(' ') || 'Không có lý do.';

      if (!member) return message.channel.send('⚠ Bạn phải tag người cần mute.');
      if (!timeArg) return message.channel.send('⚠ Ví dụ: 10s, 5m, 2h, 1d');

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
      if (!match) return message.channel.send('⚠ Sai định dạng thời gian.');

      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      const convert = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      const duration = value * convert[unit];

      await member.timeout(duration, reason);
      return message.channel.send(`🤐 **Đã mute ${member.user.tag} trong ${timeArg}**`);
    }

    if (command === 'unmute') {
      if (!isAdmin) return message.channel.send('❌ Bạn không phải admin.');
      const member = message.mentions.members.first();
      if (!member) return message.channel.send('⚠ Bạn phải tag người cần unmute.');
      await member.timeout(null);
      return message.channel.send(`🔊 **Bot đã unmute ${member.user.tag}**`);
    }
  }
});

// =========================
//  DEEPSEEK CHATBOT + MEMORY
// =========================
const { Deepseek } = require("deepseek");
const deepseek = new Deepseek({ apiKey: process.env.DEEPSEEK_API_KEY });

const memory = {};

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.mentions.users.has(client.user.id)) {

    const userId = message.author.id;

    // Tách câu hỏi khỏi mention
    const question = message.content.replace(
      new RegExp(`<@!?${client.user.id}>`, 'g'),
      ""
    ).trim();

    if (!question.length)
      return message.reply("Bạn muốn hỏi gì vậy?");

    // Tạo lịch sử chat nếu chưa có
    if (!memory[userId]) memory[userId] = [];

    // Lưu tin nhắn user
    memory[userId].push({ role: "user", content: question });

    // Giới hạn còn 10 tin
    if (memory[userId].length > 10) memory[userId].shift();

    try {
      await message.channel.sendTyping();

      const completion = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: memory[userId]
      });

      const botReply = completion.choices[0].message.content;

      memory[userId].push({ role: "assistant", content: botReply });

      return message.reply(botReply);

    } catch (err) {
      console.error("DeepSeek Error:", err);
      return message.reply("❌ Bot không kết nối được DeepSeek.");
    }
  }
});

// Đăng nhập bot
client.login(TOKEN);
