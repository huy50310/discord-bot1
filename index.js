// index.js
require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Events 
} = require('discord.js');

const TOKEN = process.env.TOKEN;

// Tạo client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,         // Slash command
    GatewayIntentBits.GuildMessages,  // Đọc tin nhắn trong server
    // GatewayIntentBits.MessageContent is a privileged intent and will cause
    // the bot to fail to connect if not enabled in the Developer Portal.
    // If you need prefix message content commands, enable it in the
    // Discord Developer Portal and re-add `GatewayIntentBits.MessageContent`.
  ],
});

// Bot login thành công
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// ========================
//  SLASH COMMAND HANDLER
// ========================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has('Administrator');

  // ---- /ping : ai cũng dùng được ----
  if (interaction.commandName === 'ping') {
    return interaction.reply({
      content: '🏓 Pong!',
      ephemeral: true
    });
  }

  // ---- /say : chỉ admin ----
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

  // ---- /announce : chỉ admin ----
  if (interaction.commandName === 'announce') {
    if (!isAdmin)
      return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    const channel = interaction.options.getChannel('channel');

    await channel.send(` ${text}`);

    return interaction.reply({
      content: `Đã gửi thông báo vào ${channel}.`,
      ephemeral: true
    });
  }
});

// ========================
//  MESSAGE (prefix + mention) HANDLER
// ========================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return; // only in guilds
  if (message.author.bot) return; // ignore bots

  const content = message.content || '';

  // ======== PREFIX :L ========
  if (content.startsWith(':L ') || content.startsWith(':l ')) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    // delete the original command to hide it
    await message.delete().catch(() => {});

    if (command === 'ping') {
      return message.channel.send('🏓 Pong!');
    }

    if (!isAdmin) {
      return message.channel.send('❌ Bạn không có quyền admin.');
    }

    if (command === 'say') {
      const text = args.join(' ');
      if (!text) return;
      return message.channel.send(text);
    }

    if (command === 'announce') {
      const text = args.join(' ');
      if (!text) return;
      return message.channel.send(`📢 **Thông báo:** ${text}`);
    }

    return; // end prefix handling
  }

  // =========================
  // MENTION-BASED COMMANDS (@Bot say ...)
  // If the bot is mentioned and the message is more than just the mention,
  // parse commands after the mention. If the message is only a mention,
  // show the command menu.
  const isMentioned = message.mentions.users.has(client.user.id) && !message.mentions.everyone;
  if (!isMentioned) return;

  // remove all mention tokens for this bot (supports <@id> and <@!id>)
  const after = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

  if (!after) {
    // just a mention -> show menu
    return message.reply({
      content: [
        '📜 **Menu lệnh của bot:**',
        '',
        '🔹 **Slash Commands (/):**',
        '• `/ping` – Kiểm tra bot hoạt động.',
        '• `/say <text>` – Bot nói thay bạn (ADMIN).',
        '• `/announce <text> <channel>` – Bot gửi thông báo (ADMIN).',
        '',
        '🔹 **Prefix Commands (:L):**',
        '• `:L ping` – Ai cũng dùng được.',
        '• `:L say <text>` – Bot nói thay bạn (ADMIN).',
        '• `:L announce <text>` – Bot thông báo (ADMIN).',
      ].join('\n'),
      allowedMentions: { repliedUser: false }
    });
  }

  const args = after.split(/ +/);
  const command = args.shift()?.toLowerCase();
  const isAdmin = message.member.permissions.has('Administrator');

  // for admin commands, hide the original message
  if (['say', 'announce', 'ban', 'unban', 'mute', 'unmute'].includes(command)) {
    await message.delete().catch(() => {});
  }

  if (command === 'ping') {
    return message.channel.send('🏓 Pong!');
  }

  if (!isAdmin && ['say', 'announce', 'ban', 'unban', 'mute', 'unmute'].includes(command)) {
    return message.channel.send('❌ Bạn không phải admin.');
  }

  if (command === 'say') {
    const text = args.join(' ');
    if (!text) return;
    return message.channel.send(text);
  }

  if (command === 'announce') {
    const text = args.join(' ');
    if (!text) return;
    return message.channel.send(`📢 **Thông báo:** ${text}`);
  }

  if (command === 'ban') {
    const member = message.mentions.members.first();
    const reason = args.slice(1).join(' ') || 'Không có lý do.';
    if (!member) return message.channel.send('⚠ Bạn phải tag người cần ban.');
    if (!member.bannable) return message.channel.send('❌ Không thể ban người này.');
    try {
      await member.ban({ reason });
      return message.channel.send(`🔨 **Bot đã ban ${member.user.tag}**\n📝 Lý do: ${reason}`);
    } catch (err) {
      console.error('ban error', err);
      return message.channel.send('❌ Không thể ban người dùng (thiếu quyền hoặc lỗi).');
    }
  }

  if (command === 'unban') {
    const userId = args[0];
    if (!userId) return message.channel.send('⚠ Bạn phải nhập user ID.');
    try {
      await message.guild.bans.remove(userId);
      return message.channel.send(`♻️ **Bot đã unban người dùng ID: ${userId}**`);
    } catch (err) {
      console.error('unban error', err);
      return message.channel.send('❌ Không unban được người này (thiếu quyền hoặc lỗi).');
    }
  }

  if (command === 'mute') {
    const member = message.mentions.members.first();
    const timeArg = args[1];
    const reason = args.slice(2).join(' ') || 'Không có lý do.';

    if (!member)
        return message.channel.send('⚠ Bạn phải tag người cần mute.');

    if (!timeArg)
        return message.channel.send('⚠ Bạn phải nhập thời gian mute. Ví dụ: 10s, 5m, 2h, 1d');

    if (!member.moderatable)
        return message.channel.send('❌ Không thể mute người này (quyền không đủ).');
      
    const timeRegex = /^(\d+)(s|m|h|d)$/i;
    const match = timeArg.match(timeRegex);

    if (!match)
        return message.channel.send('⚠ Sai định dạng thời gian. Dùng: 10s, 5m, 2h, 1d');

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    let duration = 0;

    switch (unit) {
        case 's': duration = value * 1000; break;
        case 'm': duration = value * 60 * 1000; break;
        case 'h': duration = value * 60 * 60 * 1000; break;
        case 'd': duration = value * 24 * 60 * 60 * 1000; break;
    }

    try {
        await member.timeout(duration, reason);

        message.channel.send(
            `🤐 **Đã mute ${member.user.tag} trong ${timeArg}**\n📝 Lý do: ${reason}`
        );

        setTimeout(async () => {
            try {
                await member.timeout(null);
                message.channel.send(`🔊 **Đã tự động unmute ${member.user.tag}** (hết ${timeArg})`);
            } catch (err) {
                console.error("Auto unmute error:", err.message);
            }
        }, duration);

    } catch (err) {
        console.error('mute error:', err.message);
        return message.channel.send(`❌ Lỗi khi mute: ${err.message || 'Không xác định'}`);
    }
}

  if (command === 'unmute') {
    const member = message.mentions.members.first();
    if (!member) return message.channel.send('⚠ Bạn phải tag người cần unmute.');
    if (!member.moderatable) return message.channel.send('❌ Không thể unmute người này (quyền không đủ).');
    try {
      await member.timeout(null);
      return message.channel.send(`🔊 **Bot đã unmute ${member.user.tag}**`);
    } catch (err) {
      console.error('unmute error:', err.message);
      return message.channel.send(`❌ Lỗi khi unmute: ${err.message || 'Không xác định'}`);
    }
  }
});

// Đăng nhập bot
client.login(TOKEN);