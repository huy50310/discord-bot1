require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  getVoiceConnection
} = require("@discordjs/voice");
const play = require("play-dl");
const fs = require("fs");

(async () => {
  try {
    const cookies = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
    await play.setToken({
      youtube: {
        cookie: cookies.cookie
      }
    });
    console.log("🍪 YouTube cookies loaded thành công!");
  } catch (e) {
    console.log("⚠️ Không tìm thấy youtube-cookies.json hoặc cookie lỗi.");
  }
})();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// =============== CONFIG ===============
const PREFIX = process.env.PREFIX || "!";
const TOKEN = process.env.TOKEN;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// =======================
//  GEMINI AI
// =======================
const PRIMARY_MODEL = "gemini-2.5-flash-lite";   // ưu tiên
const SECOND_MODEL  = "gemini-2.5-flash";        // dự phòng
const FALLBACK_MODEL = "gemini-pro-latest";      // fallback cuối

const userChatHistory = new Map();

// Helper gọi 1 model
async function tryModel(modelName, history, prompt) {
  const model = genAI.getGenerativeModel({ model: modelName });

  return await model.generateContent({
    contents: [
      ...history,
      { role: "user", parts: [{ text: prompt }] }
    ]
  });
}

// AI handler
async function runGemini(userId, prompt) {
  try {
    if (!userChatHistory.has(userId)) {
      userChatHistory.set(userId, [
        { 
          role: "user", 
          parts: [{ 
            text: "Hãy trả lời thân thiện, giống người thật, có cảm xúc, giữ giọng văn gần gũi." 
          }] 
        }
      ]);
    }

    const history = userChatHistory.get(userId);
    const slimHistory = history.slice(-8);
    let result;

    // 1️⃣ flash-lite
    try {
      console.log("▶ Dùng flash-lite...");
      result = await tryModel(PRIMARY_MODEL, slimHistory, prompt);
      console.log("✔ Thành công flash-lite");
    } catch (err) {
      console.warn("⚠ flash-lite lỗi:", err.message);
    }

    // 2️⃣ flash
    if (!result) {
      try {
        console.log("▶ Chuyển sang flash...");
        result = await tryModel(SECOND_MODEL, slimHistory, prompt);
        console.log("✔ Thành công flash");
      } catch (err) {
        console.warn("⚠ flash lỗi:", err.message);
      }
    }

    // 3️⃣ fallback pro-latest
    if (!result) {
      try {
        console.log("▶ Fallback → pro-latest...");
        result = await tryModel(FALLBACK_MODEL, slimHistory, prompt);
        console.log("✔ Thành công pro-latest");
      } catch (err) {
        console.warn("❌ pro-latest lỗi:", err.message);
        return "❌ Hệ thống AI đang quá tải, thử lại sau nhé!";
      }
    }

    const response = result.response.text();
    history.push({ role: "user", parts: [{ text: prompt }] });
    history.push({ role: "model", parts: [{ text: response }] });

    return response;

  } catch (err) {
    console.error("Gemini error:", err);
    return "❌ Bot không thể kết nối AI.";
  }
}

// =============== MUSIC QUEUE ===============
/**
 * queueData = {
 *  textChannel,
 *  voiceChannel,
 *  connection,
 *  player,
 *  songs: [{ title, url, duration }],
 *  playing,
 *  timeout
 * }
 */
const queues = new Map();

// Lấy hoặc tạo queue cho guild
function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      textChannel: null,
      voiceChannel: null,
      connection: null,
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
      }),
      songs: [],
      playing: false,
      timeout: null,
    });
  }
  return queues.get(guildId);
}

// Phát bài tiếp theo
async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  if (queue.songs.length === 0) {
    queue.playing = false;

    if (queue.timeout) clearTimeout(queue.timeout);
    queue.timeout = setTimeout(() => {
      if (queue.connection) {
        queue.connection.destroy();
      }
      queues.delete(guildId);
    }, 2 * 60 * 1000);

    if (queue.textChannel) {
      queue.textChannel.send("✅ Hết danh sách nhạc, sẽ rời voice sau 2 phút nếu không ai thêm bài.");
    }
    return;
  }

  const song = queue.songs[0];
  try {
    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    queue.player.play(resource);
    queue.playing = true;

    if (queue.textChannel) {
      queue.textChannel.send(`🎵 Đang phát: **${song.title}** (${song.duration || "Unknown"})`);
    }
  } catch (err) {
    console.error("Lỗi khi phát bài:", err);
    queue.songs.shift();
    playNext(guildId);
  }
}

// Thêm bài vào queue
async function addSong(msg, query) {
  const guildId = msg.guild.id;
  const queue = getQueue(guildId);

  const voiceChannel = msg.member.voice.channel;
  if (!voiceChannel) {
    return msg.reply("❌ Bạn phải vào voice channel trước đã!");
  }

  queue.textChannel = msg.channel;
  queue.voiceChannel = voiceChannel;

  if (!queue.connection) {
    queue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      adapterCreator: msg.guild.voiceAdapterCreator,
    });

    queue.connection.subscribe(queue.player);

    queue.player.on(AudioPlayerStatus.Idle, () => {
      if (queue.playing) {
        queue.songs.shift();
        playNext(guildId);
      }
    });
  }

  const isUrl = query.startsWith("http://") || query.startsWith("https://");
  let songsToAdd = [];

  try {
    if (isUrl) {
      const validate = await play.validate(query);

      if (validate === "playlist") {
        const playlist = await play.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();

        songsToAdd = videos.map(v => ({
          title: v.title,
          url: v.url,
          duration: v.durationRaw,
        }));

        msg.reply(`📃 Đã thêm **${songsToAdd.length}** bài từ playlist **${playlist.title}** vào queue.`);
      } else if (validate === "video") {
        const info = await play.video_basic_info(query);
        songsToAdd.push({
          title: info.video_details.title,
          url: info.video_details.url,
          duration: info.video_details.durationRaw,
        });
        msg.reply(`➕ Đã thêm: **${info.video_details.title}** vào queue.`);
      } else {
        return msg.reply("❌ Link không hợp lệ hoặc không hỗ trợ.");
      }
    } else {
      const results = await play.search(query, { limit: 1 });
      if (!results.length) {
        return msg.reply("❌ Không tìm thấy bài hát nào phù hợp.");
      }

      const v = results[0];
      songsToAdd.push({
        title: v.title,
        url: v.url,
        duration: v.durationRaw,
      });
      msg.reply(`🔍 Tìm thấy & thêm vào queue: **${v.title}**`);
    }
  } catch (err) {
    console.error("Lỗi khi tìm/parse bài:", err);
    return msg.reply("❌ Có lỗi khi xử lý bài hát, thử lại sau.");
  }

  queue.songs.push(...songsToAdd);

  if (!queue.playing) {
    playNext(guildId);
  }
}

// =============== READY + STATUS TỰ ĐỘNG ===============
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  // 🎯 Status theo thời điểm trong ngày
  const timeBased = {
    morning: [
      "chúc bạn một ngày tốt lành ☀️",
      "uống cà phê cùng bạn ☕",
      "đón nắng sớm 🌤️",
      "tập trung nào! hôm nay bạn sẽ làm được 💪"
    ],
    noon: [
      "nghỉ ngơi giữa trưa 😌",
      "ăn trưa cùng bạn 🍱",
      "hít thở một chút nha 🌼",
      "giữa ngày rồi, cố lên 💛"
    ],
    evening: [
      "ở đây với bạn 🌙",
      "tâm sự buổi tối ✨",
      "chill cùng nhạc 🎶",
      "mong bạn có buổi tối nhẹ nhàng 💕"
    ],
    night: [
      "buồn ngủ rồi… 😴",
      "thức khuya cùng bạn 🌙",
      "ôm cái nè 💛",
      "đi ngủ sớm nha 😣"
    ]
  };

  // 🎯 Status theo ngày trong tuần
  const dayBased = {
    0: ["chủ nhật thư giãn 🌿", "ngày nghỉ nhẹ nhàng 💛"],
    1: ["thứ hai đầy năng lượng 💼", "tuần mới cố lên! 💪"],
    2: ["thứ ba vui vẻ 🌈", "giữ nhịp xuyên tuần nhé ✨"],
    3: ["thứ tư nửa tuần rồi 🌟", "cố thêm chút nữa nha 💕"],
    4: ["thứ năm nhẹ nhàng 🎶", "gần cuối tuần rồi ✨"],
    5: ["thứ sáu tuyệt vời 🎉", "TGIF 🍻"],
    6: ["thứ bảy thoải mái 🌺", "cuối tuần chill thôi 🎧"]
  };

  function getTimePeriod() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return "morning";
    if (hour >= 11 && hour < 17) return "noon";
    if (hour >= 17 && hour < 22) return "evening";
    return "night";
  }

  function pickStatus() {
    const day = new Date().getDay();
    const time = getTimePeriod();

    const dayList = dayBased[day];
    const timeList = timeBased[time];

    const d = dayList[Math.floor(Math.random() * dayList.length)];
    const t = timeList[Math.floor(Math.random() * timeList.length)];

    return `${d} • ${t}`;
  }

  function updateStatus() {
    const statusText = pickStatus();

    client.user.setPresence({
      status: "online",
      activities: [
        { name: statusText, type: 4 } // custom status
      ]
    });

    console.log(`🎀 Status updated → ${statusText}`);
  }

  updateStatus();
  setInterval(updateStatus, 5 * 60 * 1000);
});

// =======================
//  SLASH COMMANDS
// =======================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has("Administrator");

  if (interaction.commandName === "ping")
    return interaction.reply({ content: "🏓 Pong!", flags: 64 });

  if (interaction.commandName === "say") {
    if (!isAdmin)
      return interaction.reply({ content: "❌ Bạn không phải admin.", flags: 64 });

    const text = interaction.options.getString("text");
    await interaction.channel.send(text);

    return interaction.reply({ content: "✅ Bot đã nói thay bạn.", flags: 64 });
  }

  if (interaction.commandName === "announce") {
    if (!isAdmin)
      return interaction.reply({ content: "❌ Bạn không phải admin.", flags: 64 });

    const text = interaction.options.getString("text");
    const channel = interaction.options.getChannel("channel");

    await channel.send(`📢 ${text}`);
    return interaction.reply({ content: `Đã gửi thông báo vào ${channel}.`, flags: 64 });
  }
});

// =============== MESSAGE HANDLER (PREFIX + :L + MENTION + AI) ===============
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  let content = message.content || "";
  const guildId = message.guild.id;
  const isAdmin = message.member.permissions.has("Administrator");

  // ========================
  // 1) PREFIX COMMANDS (MUSIC + ADMIN)
  // ========================
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const queue = getQueue(guildId);

    try {
      switch (command) {
        // ===== MUSIC =====
        case "play": {
          const query = args.join(" ");
          if (!query) {
            return message.reply("❌ Dùng: `!play <link YouTube hoặc tên bài>`");
          }
          await addSong(message, query);
          break;
        }

        case "skip": {
          if (!queue.songs.length || !queue.playing) {
            return message.reply("❌ Không có bài nào đang phát.");
          }
          message.reply("⏭ Đã chuyển sang bài tiếp theo.");
          queue.songs.shift();
          playNext(guildId);
          break;
        }

        case "stop": {
          if (queue.timeout) clearTimeout(queue.timeout);
          queue.songs = [];
          queue.playing = false;
          queue.player.stop(true);

          const conn = getVoiceConnection(guildId);
          if (conn) conn.destroy();

          queues.delete(guildId);
          message.reply("🛑 Đã dừng nhạc và rời khỏi voice.");
          break;
        }

        case "pause": {
          if (!queue.playing) return message.reply("❌ Không có nhạc đang phát.");
          queue.player.pause();
          queue.playing = false;
          message.reply("⏸ Đã tạm dừng.");
          break;
        }

        case "resume": {
          queue.player.unpause();
          queue.playing = true;
          message.reply("▶️ Tiếp tục phát.");
          break;
        }

        case "queue": {
          if (!queue.songs.length) {
            return message.reply("📭 Queue đang trống.");
          }

          const current = queue.songs[0];
          const rest = queue.songs.slice(1, 10);

          let desc = `🎵 **Đang phát:** ${current.title} (${current.duration || "?"})\n`;
          if (rest.length) {
            desc += `\n📜 **Tiếp theo:**\n`;
            rest.forEach((s, i) => {
              desc += `${i + 1}. ${s.title} (${s.duration || "?"})\n`;
            });
          } else {
            desc += `\n📜 Không còn bài nào tiếp theo.`;
          }

          message.reply(desc);
          break;
        }

        case "help":
        case "music":
        case "commands": {
          message.reply(
            [
              "🎶 **Lệnh nhạc:**",
              "`!play <link hoặc tên bài>`",
              "`!skip`",
              "`!stop`",
              "`!pause`",
              "`!resume`",
              "`!queue`",
              "",
              "🛡 **Lệnh admin:**",
              "`!ban @user [lý do]`",
              "`!unban <userId>`",
              "`!mute @user <10s|5m|2h|1d> [lý do]`",
              "`!unmute @user`"
            ].join("\n")
          );
          break;
        }

        // ===== ADMIN (PREFIX) =====
        case "ban": {
          if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
          const member = message.mentions.members.first();
          const reason = args.slice(1).join(" ") || "Không có lý do.";

          if (!member) return message.reply("⚠ Bạn phải tag người cần ban.");
          if (!member.bannable) return message.reply("❌ Không thể ban.");

          await member.ban({ reason });
          return message.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
        }

        case "unban": {
          if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
          const userId = args[0];
          if (!userId) return message.reply("⚠ Nhập user ID.");

          await message.guild.bans.remove(userId);
          return message.reply(`♻️ Đã unban ID: **${userId}**`);
        }

        case "mute": {
          if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

          const member = message.mentions.members.first();
          const timeArg = args[1];
          const reason = args.slice(2).join(" ") || "Không có lý do.";

          if (!member) return message.reply("⚠ Tag người cần mute.");
          if (!timeArg) return message.reply("⚠ Nhập thời gian. Ví dụ: 10s, 5m, 2h");
          if (!member.moderatable) return message.reply("❌ Không thể mute.");

          const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
          if (!match) return message.reply("⚠ Sai định dạng 10s, 5m, 2h");

          const value = parseInt(match[1]);
          const unit = match[2].toLowerCase();

          const duration =
            unit === "s" ? value * 1000 :
            unit === "m" ? value * 60000 :
            unit === "h" ? value * 3600000 :
                            value * 86400000;

          await member.timeout(duration, reason);
          return message.reply(`🤐 Mute **${member.user.tag}** trong **${timeArg}**`);
        }

        case "unmute": {
          if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
          const member = message.mentions.members.first();
          if (!member) return message.reply("⚠ Tag người cần unmute.");

          await member.timeout(null);
          return message.reply(`🔊 Unmute **${member.user.tag}**`);
        }

        case "shutdown": {
          if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
          await message.reply("🔌 Bot đang tắt...");
          console.log("Bot tắt theo yêu cầu admin (PREFIX).");
          process.exit(0);
        }

        default:
          break;
      }
    } catch (err) {
      console.error("Lỗi command (PREFIX):", err);
      message.reply("❌ Có lỗi xảy ra khi xử lý lệnh.");
    }

    return; // Đã xử lý PREFIX → không xử lý tiếp
  }

  // ========================
  // 2) PREFIX :L (say / announce ẩn)
  // ========================
  // FIX auto mention + prefix :L
  if (content.includes(`<@${client.user.id}>`) && content.startsWith(":L")) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  }

  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    await message.delete().catch(() => {});

    if (command === "ping")
      return message.channel.send("🏓 Pong!");

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

  // ========================
  // 3) MENTION BOT → ADMIN + GEMINI
  // ========================
  const isMentioned = message.mentions.users.has(client.user.id);
  if (isMentioned) {
    let after = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = after.split(/ +/);
    const command = args.shift()?.toLowerCase();

    // SHUTDOWN
    if (command === "shutdown") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      await message.reply("🔌 Bot đang tắt...");
      console.log("Bot tắt theo yêu cầu admin (MENTION).");
      return process.exit(0);
    }

    // BAN
    if (command === "ban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Bạn phải tag người cần ban.");
      if (!member.bannable) return message.reply("❌ Không thể ban.");

      await member.ban({ reason });
      return message.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
    }

    // UNBAN
    if (command === "unban") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const userId = args[0];
      if (!userId) return message.reply("⚠ Nhập user ID.");

      await message.guild.bans.remove(userId);
      return message.reply(`♻️ Đã unban ID: **${userId}**`);
    }

    // MUTE
    if (command === "mute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");

      const member = message.mentions.members.first();
      const timeArg = args[1];
      const reason = args.slice(2).join(" ") || "Không có lý do.";

      if (!member) return message.reply("⚠ Tag người cần mute.");
      if (!timeArg) return message.reply("⚠ Nhập thời gian. Ví dụ: 10s, 5m, 2h");
      if (!member.moderatable) return message.reply("❌ Không thể mute.");

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/i);
      if (!match) return message.reply("⚠ Sai định dạng 10s, 5m, 2h");

      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      const duration =
        unit === "s" ? value * 1000 :
        unit === "m" ? value * 60000 :
        unit === "h" ? value * 3600000 :
                        value * 86400000;

      await member.timeout(duration, reason);
      return message.reply(`🤐 Mute **${member.user.tag}** trong **${timeArg}**`);
    }

    // UNMUTE
    if (command === "unmute") {
      if (!isAdmin) return message.reply("❌ Bạn không phải admin.");
      
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠ Tag người cần unmute.");

      await member.timeout(null);
      return message.reply(`🔊 Unmute **${member.user.tag}**`);
    }

    // GEMINI CHAT
    if (after) {
      const reply = await runGemini(message.author.id, after);
      return message.reply(reply);
    }

    return message.reply("🤖 Bạn muốn hỏi gì?");
  }
});

// LOGIN
client.login(TOKEN);

