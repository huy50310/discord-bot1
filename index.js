require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActivityType,
  PermissionsBitField
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
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ============================
// LOAD YOUTUBE COOKIE
// ============================
(async () => {
  try {
    const cookie = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
    await play.setToken({ youtube: { cookie: cookie.cookie } });
    console.log("🍪 YouTube cookie loaded!");
  } catch {
    console.log("⚠ No youtube-cookies.json, continuing without cookies.");
  }
})();

const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================
// INIT CLIENT
// ============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ============================
// AI SYSTEM
// ============================
const PRIMARY = "gemini-2.5-flash-lite";
const SECOND = "gemini-2.5-flash";
const FALLBACK = "gemini-pro-latest";

const historyMap = new Map();

async function callModel(model, history, prompt) {
  const m = genAI.getGenerativeModel({ model });
  return m.generateContent({
    contents: [...history, { role: "user", parts: [{ text: prompt }] }]
  });
}

async function runGemini(uid, prompt) {
  try {
    if (!historyMap.has(uid)) {
      historyMap.set(uid, [
        { role: "user", parts: [{ text: "Hãy trả lời tự nhiên, thân thiện." }] }
      ]);
    }

    let h = historyMap.get(uid).slice(-8);
    let ans;

    try { ans = await callModel(PRIMARY, h, prompt); } catch {}
    if (!ans) try { ans = await callModel(SECOND, h, prompt); } catch {}
    if (!ans) try { ans = await callModel(FALLBACK, h, prompt); } catch {
      return "❌ AI đang bận, thử lại sau.";
    }

    const text = ans.response.text();
    historyMap.get(uid).push(
      { role: "user", parts: [{ text: prompt }] },
      { role: "model", parts: [{ text }] }
    );

    return text;

  } catch (e) {
    console.log("AI Error:", e);
    return "❌ Lỗi AI.";
  }
}

// ============================
// MUSIC QUEUE + STREAM FIX
// ============================
const queues = new Map();

function getQueue(gid) {
  if (!queues.has(gid)) {
    queues.set(gid, {
      text: null,
      voice: null,
      conn: null,
      list: [],
      playing: false,
      timeout: null,
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
      })
    });
  }
  return queues.get(gid);
}

// CHUYỂN MỌI DẠNG LINK → WATCH URL CHUẨN
function normalizeURL(url) {
  try {
    if (url.includes("watch?v="))
      return "https://www.youtube.com/watch?v=" + url.split("watch?v=")[1].split("&")[0];

    if (url.includes("youtu.be/"))
      return "https://www.youtube.com/watch?v=" + url.split("youtu.be/")[1].split(/[?&]/)[0];

    if (url.includes("shorts/"))
      return "https://www.youtube.com/watch?v=" + url.split("shorts/")[1].split(/[?&]/)[0];

    if (url.includes("embed/"))
      return "https://www.youtube.com/watch?v=" + url.split("embed/")[1].split(/[?&]/)[0];

    let v = new URL(url).searchParams.get("v");
    if (v) return "https://www.youtube.com/watch?v=" + v;

    return null;
  } catch {
    return null;
  }
}

async function playNext(gid) {
  const q = getQueue(gid);

  if (!q.list.length) {
    q.playing = false;

    if (q.timeout) clearTimeout(q.timeout);
    q.timeout = setTimeout(() => {
      const conn = getVoiceConnection(gid);
      if (conn) conn.destroy();
      queues.delete(gid);
    }, 120000);

    if (q.text) q.text.send("📭 Hết nhạc! Bot sẽ rời voice sau 2 phút.");
    return;
  }

  const song = q.list[0];

  try {
    console.log("▶ Streaming:", song.url);

    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });

    q.player.play(resource);
    q.playing = true;

    if (q.text)
      q.text.send(`🎶 Đang phát: **${song.title}** (${song.duration})`);

  } catch (err) {
    console.log("STREAM FAIL:", err);
    q.list.shift();
    playNext(gid);
  }
}

// FIX STREAM 100%
async function addSong(msg, query) {
  const gid = msg.guild.id;
  const q = getQueue(gid);

  const vc = msg.member.voice.channel;
  if (!vc) return msg.reply("❌ Bạn phải vào voice trước.");

  q.text = msg.channel;
  q.voice = vc;

  if (!q.conn) {
    q.conn = joinVoiceChannel({
      channelId: vc.id,
      guildId: gid,
      adapterCreator: msg.guild.voiceAdapterCreator
    });

    q.conn.subscribe(q.player);

    q.player.on(AudioPlayerStatus.Idle, () => {
      q.list.shift();
      playNext(gid);
    });
  }

  let videoId;

  if (query.startsWith("http")) {
    const fixed = normalizeURL(query);
    if (!fixed) return msg.reply("❌ Link YouTube không hợp lệ.");
    videoId = fixed.split("v=")[1];
  } else {
    const r = await play.search(query, { limit: 1 });
    if (!r.length) return msg.reply("❌ Không tìm thấy bài.");
    videoId = r[0].id;
  }

  if (!videoId) return msg.reply("❌ Không lấy được ID video.");

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await play.video_basic_info(url);

  const song = {
    title: info.video_details.title,
    url,
    duration: info.video_details.durationRaw
  };

  q.list.push(song);
  msg.reply(`➕ Đã thêm: **${song.title}**`);

  if (!q.playing) playNext(gid);
}
// ============================
// AUTO STATUS UPDATE
// ============================
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot Online: ${c.user.tag}`);

  const statuses = [
    "🎶 Nhập !play để nghe nhạc",
    "💬 Tag tôi để trò chuyện AI",
    "🎧 Chill cùng bạn",
    "🤖 Gemini AI + Music Bot",
    "🛠 Admin tools ready"
  ];

  function updateStatus() {
    const s = statuses[Math.floor(Math.random() * statuses.length)];
    client.user.setPresence({
      status: "online",
      activities: [{ name: s, type: ActivityType.Playing }]
    });
  }

  updateStatus();
  setInterval(updateStatus, 5 * 60 * 1000);
});

// ============================
// ADMIN FUNCTIONS
// ============================

// Convert 10s / 5m / 2h / 1d → milliseconds
function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  return (
    unit === "s" ? value * 1000 :
    unit === "m" ? value * 60000 :
    unit === "h" ? value * 3600000 :
                   value * 86400000
  );
}

// BAN
async function adminBan(msg, args) {
  const member = msg.mentions.members.first();
  const reason = args.slice(1).join(" ") || "Không có lý do.";

  if (!member) return msg.reply("⚠ Bạn phải tag người cần ban.");
  if (!member.bannable) return msg.reply("❌ Không thể ban người này.");

  await member.ban({ reason });
  return msg.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
}

// UNBAN
async function adminUnban(msg, args) {
  const id = args[0];
  if (!id) return msg.reply("⚠ Nhập user ID.");

  await msg.guild.bans.remove(id).catch(() => {});
  return msg.reply(`♻️ Đã unban ID **${id}**`);
}

// MUTE
async function adminMute(msg, args) {
  const member = msg.mentions.members.first();
  const timeArg = args[1];
  const reason = args.slice(2).join(" ") || "Không có lý do.";

  if (!member) return msg.reply("⚠ Tag người cần mute.");
  if (!timeArg) return msg.reply("⚠ Nhập thời gian: 10s | 5m | 2h | 1d");
  if (!member.moderatable) return msg.reply("❌ Không thể mute người này.");

  const duration = parseDuration(timeArg);
  if (!duration) return msg.reply("⚠ Sai định dạng thời gian.");

  await member.timeout(duration, reason);
  return msg.reply(`🤐 Đã mute **${member.user.tag}** trong **${timeArg}**`);
}

// UNMUTE
async function adminUnmute(msg) {
  const member = msg.mentions.members.first();
  if (!member) return msg.reply("⚠ Tag người cần unmute.");

  await member.timeout(null);
  return msg.reply(`🔊 Đã unmute **${member.user.tag}**`);
}

// SHUTDOWN
async function adminShutdown(msg) {
  await msg.reply("🔌 Bot đang tắt...");
  console.log("Bot shutdown by admin.");
  process.exit(0);
}

// ======================================
// :L  LỆNH ẨN (SAY / ANNOUNCE ẨN TIN NHẮN)
// ======================================
async function handleHiddenCommand(msg, content) {
  const args = content.slice(3).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  await msg.delete().catch(() => {});

  if (!msg.member.permissions.has("Administrator"))
    return msg.channel.send("❌ Bạn không có quyền admin.");

  if (cmd === "ping") return msg.channel.send("🏓 Pong!");

  if (cmd === "say") {
    return msg.channel.send(args.join(" "));
  }

  if (cmd === "announce") {
    return msg.channel.send(`📢 **Thông báo:** ${args.join(" ")}`);
  }
}
// ======================================
// MESSAGE HANDLER (PREFIX + :L + MENTION)
// ======================================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.inGuild() || msg.author.bot) return;

  let content = msg.content || "";
  const gid = msg.guild.id;
  const isAdmin = msg.member.permissions.has("Administrator");
  const queue = getQueue(gid);

  // ========================
  // 1) PREFIX COMMANDS
  // ========================
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    try {
      // ----- MUSIC -----
      if (cmd === "play") {
        if (!args.length) return msg.reply("❌ Dùng: !play <link hoặc tên bài>");
        await addSong(msg, args.join(" "));
      }

      else if (cmd === "skip") {
        queue.list.shift();
        msg.reply("⏭ Đã skip!");
        playNext(gid);
      }

      else if (cmd === "pause") {
        queue.player.pause();
        msg.reply("⏸ Đã tạm dừng.");
      }

      else if (cmd === "resume") {
        queue.player.unpause();
        msg.reply("▶ Đã tiếp tục phát.");
      }

      else if (cmd === "queue") {
        if (!queue.list.length) return msg.reply("📭 Queue trống.");
        msg.reply(
          queue.list
            .map((s, i) => `${i === 0 ? "🎧 Đang phát:" : `${i}.`} ${s.title}`)
            .join("\n")
        );
      }

      else if (cmd === "stop") {
        queue.list = [];
        queue.player.stop();
        const conn = getVoiceConnection(gid);
        if (conn) conn.destroy();
        queues.delete(gid);
        msg.reply("🛑 Đã dừng nhạc và rời voice.");
      }

      // ----- ADMIN -----
      else if (cmd === "ban") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminBan(msg, args);
      }

      else if (cmd === "unban") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminUnban(msg, args);
      }

      else if (cmd === "mute") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminMute(msg, args);
      }

      else if (cmd === "unmute") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminUnmute(msg);
      }

      else if (cmd === "shutdown") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminShutdown(msg);
      }

    } catch (err) {
      console.log("PREFIX ERROR:", err);
      msg.reply("❌ Lỗi khi xử lý lệnh.");
    }

    return; // Dừng không xử lý tiếp
  }

  // ========================
  // 2) LỆNH ẨN :L (say / announce)
  // ========================
  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    return handleHiddenCommand(msg, content);
  }

  // ========================
  // 3) MENTION BOT (ADMIN + AI)
  // ========================
  const botMentioned = msg.mentions.users.has(client.user.id);
  if (botMentioned) {
    let text = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = text.split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    // ----- ADMIN THROUGH MENTION -----
    if (cmd === "shutdown") {
      if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
      return adminShutdown(msg);
    }

    if (cmd === "ban") {
      if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
      return adminBan(msg, args);
    }

    if (cmd === "unban") {
      if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
      return adminUnban(msg, args);
    }

    if (cmd === "mute") {
      if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
      return adminMute(msg, args);
    }

    if (cmd === "unmute") {
      if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
      return adminUnmute(msg);
    }

    // ----- AI CHAT -----
    if (text.length > 0) {
      const answer = await runGemini(msg.author.id, text);
      return msg.reply(answer);
    }

    return msg.reply("🤖 Bạn muốn hỏi gì?");
  }
});
// ======================================
// CUỐI FILE — LOGIN BOT
// ======================================

client.login(TOKEN)
  .then(() => console.log("🔑 Login thành công! Bot đang chạy..."))
  .catch(err => {
    console.error("❌ Lỗi khi login bot:", err);
    process.exit(1);
  });


// ======================================
// CHỐNG CRASH — GIỮ BOT ỔN ĐỊNH
// ======================================

process.on("unhandledRejection", (reason, promise) => {
  console.log("⚠ Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.log("⚠ Uncaught Exception:", err);
});

process.on("uncaughtExceptionMonitor", (err) => {
  console.log("⚠ Uncaught Exception Monitor:", err);
});

console.log("✅ index.js V5 FULL đã load hoàn chỉnh!");
