require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Events 
} = require('discord.js');

// ======================
//  DeepSeek Chat Function
// ======================
async function askDeepSeek(prompt, history = []) {
  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          ...history,
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "Không có phản hồi.";
  } catch (err) {
    console.error("DeepSeek API error:", err);
    return "❌ Lỗi kết nối DeepSeek API.";
  }
}

// Lưu lịch sử chat theo user
const userMemory = {};

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
    if (!isAdmin) return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    await interaction.channel.send(text);
    return interaction.reply({ content: '✅ Bot đã nói thay bạn.', ephemeral: true });
  }

  if (interaction.commandName === 'announce') {
    if (!isAdmin) return interaction.reply({ content: '❌ Bạn không phải admin.', ephemeral: true });

    const text = interaction.options.getString('text');
    const channel = interaction.options.getChannel('channel');

    await channel.send(text);
    return interaction.reply({ content: `Đã gửi thông báo vào ${channel}.`, ephemeral: true });
  }
});

// ========================
//  MESSAGE HANDLER
// ========================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content;

  // --------------------
  // PREFIX COMMANDS :L
  // --------------------
  if (content.startsWith(':L ') || content.startsWith(':l ')) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    await message.delete().catch(() => {});

    if (command === 'ping') return message.channel.send('🏓 Pong!');
    if (!isAdmin) return message.channel.send('❌ Bạn không có quyền admin.');

    if (command === 'say') return message.channel.send(args.join(' '));
    if (command === 'announce') return message.channel.send(`📢 **Thông báo:** ${args.join(' ')}`);

    return;
  }

  // ======================
  //   MENTION BOT → CHAT AI
  // ======================
  if (message.mentions.users.has(client.user.id)) {
    const text = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const userId = message.author.id;

    // Nếu chỉ tag bot → hiện menu hỗ trợ
    if (!text.length) {
      return message.reply({
        content:
`📜 **Menu lệnh của bot:**

🔹 **Chat AI (DeepSeek)**
• Tag bot rồi hỏi:  \`@bot <câu hỏi>\`

🔹 **Slash Commands (/)**
• \`/ping\` — Kiểm tra bot.
• \`/say <text>\` — Bot nói thay bạn (ADMIN).
• \`/announce <text> <channel>\` — Bot gửi thông báo (ADMIN).

🔹 **Prefix Commands (:L)**
• \`:L ping\`
• \`:L say <text>\` (ADMIN)
• \`:L announce <text>\` (ADMIN)
`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Lưu lịch sử chat
    if (!userMemory[userId]) userMemory[userId] = [];
    userMemory[userId].push({ role: "user", content: text });
    if (userMemory[userId].length > 10) userMemory[userId].shift();

    await message.channel.sendTyping();

    const answer = await askDeepSeek(text, userMemory[userId]);

    userMemory[userId].push({ role: "assistant", content: answer });
    if (userMemory[userId].length > 10) userMemory[userId].shift();

    return message.reply(answer);
  }

  // ======================
  //  BAN / UNBAN / MUTE / UNMUTE
  // ======================
  const args = content.split(/ +/);
  const cmd = args.shift()?.toLowerCase();
  const isAdmin = message.member.permissions.has('Administrator');

  if (!isAdmin) return;

  if (cmd === 'ban') {
    const member = message.mentions.members.first();
    const reason = args.slice(1).join(" ") || "Không có lý do.";

    if (!member) return message.reply("⚠ Tag người cần ban");

    try {
      await member.ban({ reason });
      return message.channel.send(`🔨 Đã ban **${member.user.tag}**`);
    } catch {
      return message.channel.send("❌ Không thể ban.");
    }
  }

  if (cmd === 'unban') {
    const uid = args[0];
    try {
      await message.guild.bans.remove(uid);
      return message.channel.send(`♻️ Đã unban ID: ${uid}`);
    } catch {
      return message.channel.send("❌ Không thể unban.");
    }
  }

  if (cmd === 'mute') {
    const member = message.mentions.members.first();
    const t = args[1];
    const reason = args.slice(2).join(" ") || "Không có lý do.";

    if (!member) return message.reply("⚠ Tag người cần mute.");
    if (!t) return message.reply("⚠ Nhập thời gian: 10s, 5m, 1h...");

    const regex = /^(\d+)(s|m|h|d)$/i;
    const m = t.match(regex);
    if (!m) return message.reply("⚠ Sai định dạng.");

    const val = parseInt(m[1]);
    const unit = m[2].toLowerCase();
    let ms = 0;
    if (unit === "s") ms = val * 1000;
    if (unit === "m") ms = val * 60000;
    if (unit === "h") ms = val * 3600000;
    if (unit === "d") ms = val * 86400000;

    try {
      await member.timeout(ms, reason);
      return message.channel.send(`🤐 Đã mute **${member.user.tag}** trong ${t}`);
    } catch (e) {
      return message.channel.send("❌ Không mute được.");
    }
  }

  if (cmd === 'unmute') {
    const member = message.mentions.members.first();
    if (!member) return message.reply("⚠ Tag người cần unmute.");

    try {
      await member.timeout(null);
      return message.channel.send(`🔊 Đã unmute **${member.user.tag}**`);
    } catch {
      return message.channel.send("❌ Không unmute được.");
    }
  }

});

client.login(process.env.TOKEN);
