require("dotenv").config();

// ======================================
// IMPORTS
// ======================================
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

const { GoogleGenerativeAI } = require("@google/generative-ai");
const ytdlp = require("youtube-dl-exec");
const { Readable } = require("stream");

// ======================================
// CONFIG
// ======================================
const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY = "gemini-2.5-flash-lite";
const SECOND = "gemini-2.5-flash";
const FALLBACK = "gemini-pro-latest";

// ======================================
// DISCORD CLIENT
// ======================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ======================================
// GEMINI AI
// ======================================
const chatHistory = new Map();

async function callAI(model, history, prompt) {
  const m = genAI.getGenerativeModel({ model });
  return m.generateContent({
    contents: [...history, { role: "user", parts: [{ text: prompt }] }]
  });
}

async function runGemini(uid, prompt) {
  try {
    if (!chatHistory.has(uid)) {
      chatHistory.set(uid, [
        { role: "user", parts: [{ text: "Hãy trả lời thân thiện như người thật." }] }
      ]);
    }

    const h = chatHistory.get(uid).slice(-8);
    let result;

    try { result = await callAI(PRIMARY, h, prompt); } catch {}
    if (!result) try { result = await callAI(SECOND, h, prompt); } catch {}
    if (!result) try { result = await callAI(FALLBACK, h, prompt); }
      catch { return "❌ AI đang bận, thử lại sau."; }

    const text = result.response.text();
    chatHistory.get(uid).push(
      { role: "user", parts: [{ text: prompt }] },
      { role: "model", parts: [{ text }] }
    );

    return text;

  } catch (e) {
    console.log("AI error:", e);
    return "❌ Có lỗi AI.";
  }
}

// ======================================
// MUSIC SYSTEM (YOUTUBE-DL-EXEC)
// ======================================
const queues = new Map();

function getQueue(gid) {
  if (!queues.has(gid)) {
    queues.set(gid, {
      list: [],
      playing: false,
      text: null,
      voice: null,
      conn: null,
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
      }),
      timeout: null
    });
  }
  return queues.get(gid);
}

// Chuẩn hóa URL YouTube
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

    const v = new URL(url).searchParams.get("v");
    if (v) return "https://www.youtube.com/watch?v=" + v;

    return null;

  } catch {
    return null;
  }
}

async function getAudioStream(url) {
  const proc = ytdlp(url, {
    output: "-",
    format: "bestaudio",
    quiet: true
  });

  return Readable.from(proc.stdout);
}

// PHÁT NHẠC
async function playNext(gid) {
  const q = getQueue(gid);

  if (!q.list.length) {
    q.playing = false;

    if (q.timeout) clearTimeout(q.timeout);
    q.timeout = setTimeout(() => {
      const c = getVoiceConnection(gid);
      if (c) c.destroy();
      queues.delete(gid);
    }, 2 * 60 * 1000);

    q.text?.send("📭 Hết nhạc! Bot sẽ rời voice sau 2 phút.");
    return;
  }

  const song = q.list[0];

  try {
    q.text?.send(`🎶 Đang phát: **${song.title}** (${song.duration})`);

    const stream = await getAudioStream(song.url);
    const resource = createAudioResource(stream);

    q.player.play(resource);
    q.playing = true;

  } catch (e) {
    console.log("STREAM ERROR:", e);
    q.text?.send("⚠️ Lỗi khi phát nhạc → Skip");
    q.list.shift();
    playNext(gid);
  }
}

// THÊM BÀI NHẠC
async function addSong(msg, query) {
  const gid = msg.guild.id;
  const q = getQueue(gid);

  const vc = msg.member.voice.channel;
  if (!vc) return msg.reply("❌ Vào voice trước đã.");

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
      if (q.playing) {
        q.list.shift();
        playNext(gid);
      }
    });
  }

  let url;
  if (query.startsWith("http")) {
    url = normalizeURL(query);
  }

  // SEARCH
  if (!url) {
    const search = await ytdlp(query, {
      dumpSingleJson: true,
      defaultSearch: "ytsearch",
      quiet: true
    });

    if (!search.entries?.length)
      return msg.reply("❌ Không tìm thấy bài hát.");

    url = "https://www.youtube.com/watch?v=" + search.entries[0].id;
  }

  const info = await ytdlp(url, {
    dumpSingleJson: true,
    quiet: true
  });

  const song = {
    title: info.title,
    url,
    duration: info.duration_string || "?"
  };

  q.list.push(song);
  msg.reply(`➕ Đã thêm: **${song.title}**`);

  if (!q.playing) playNext(gid);
}

// ======================================
// STATUS
// ======================================
client.once(Events.ClientReady, () => {
  console.log(`💚 Bot Online: ${client.user.tag}`);

  const statuses = [
    "🎶 Bot nhạc không lỗi",
    "🤖 Chat bằng AI",
    "🛡 Admin ready",
    "✨ Yang Hui Bot"
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

// ======================================
// ADMIN SYSTEM
// ======================================
function parseDuration(str) {
  const m = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;

  const v = Number(m[1]);
  const u = m[2];

  return u === "s" ? v * 1000 :
         u === "m" ? v * 60000 :
         u === "h" ? v * 3600000 :
                     v * 86400000;
}

async function adminBan(msg, args) {
  const m = msg.mentions.members.first();
  if (!m) return msg.reply("⚠ Tag người cần ban.");

  const reason = args.slice(1).join(" ") || "Không có lý do";
  await m.ban({ reason });
  msg.reply(`🔨 Đã ban: **${m.user.tag}**`);
}

async function adminUnban(msg, args) {
  const id = args[0];
  if (!id) return msg.reply("⚠ Nhập userID");

  await msg.guild.bans.remove(id).catch(() => {});
  msg.reply(`♻ Unban: **${id}**`);
}

async function adminMute(msg, args) {
  const m = msg.mentions.members.first();
  if (!m) return msg.reply("⚠ Tag người cần mute");

  const dur = parseDuration(args[1]);
  if (!dur) return msg.reply("⚠ Sai thời gian. Ví dụ: 10s 5m 2h");

  await m.timeout(dur, args.slice(2).join(" ") || "Không có lý do");
  msg.reply(`🤐 Mute **${m.user.tag}** ${args[1]}`);
}

async function adminUnmute(msg) {
  const m = msg.mentions.members.first();
  if (!m) return msg.reply("⚠ Tag người cần unmute");

  await m.timeout(null);
  msg.reply(`🔊 Unmute **${m.user.tag}**`);
}

// ======================================
// MESSAGE HANDLER
// ======================================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.inGuild() || msg.author.bot) return;

  const content = msg.content;
  const gid = msg.guild.id;
  const isAdmin = msg.member.permissions.has("Administrator");

  // PREFIX COMMANDS
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    try {
      // MUSIC
      if (cmd === "play") return addSong(msg, args.join(" "));
      if (cmd === "skip") {
        const q = getQueue(gid);
        q.list.shift();
        msg.reply("⏭ Skip!");
        return playNext(gid);
      }
      if (cmd === "pause") {
        getQueue(gid).player.pause();
        return msg.reply("⏸ Đã pause.");
      }
      if (cmd === "resume") {
        getQueue(gid).player.unpause();
        return msg.reply("▶ Đã resume.");
      }
      if (cmd === "queue") {
        const q = getQueue(gid);
        if (!q.list.length) return msg.reply("📭 Queue trống.");
        return msg.reply(
          q.list.map((s, i) =>
            `${i === 0 ? "🎧 Đang phát:" : `${i}.`} ${s.title}`
          ).join("\n")
        );
      }
      if (cmd === "stop") {
        const q = getQueue(gid);
        q.list = [];
        q.player.stop();
        const c = getVoiceConnection(gid);
        if (c) c.destroy();
        queues.delete(gid);
        return msg.reply("🛑 Đã dừng & rời voice.");
      }

      // ADMIN
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
      if (cmd === "shutdown") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        msg.reply("🔌 Bot đang tắt...");
        return process.exit(0);
      }

    } catch (e) {
      console.log("CMD ERROR:", e);
      msg.reply("❌ Lỗi khi xử lý lệnh.");
    }

    return;
  }

  // MENTION → AI
  if (msg.mentions.users.has(client.user.id)) {
    let text = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    if (!text) return msg.reply("🤖 Bạn muốn hỏi gì?");
    const reply = await runGemini(msg.author.id, text);
    return msg.reply(reply);
  }
});

// ======================================
// LOGIN + ERROR HANDLER
// ======================================
client.login(TOKEN)
  .then(() => console.log("🔑 Đăng nhập thành công!"))
  .catch(err => console.log("❌ LOGIN ERROR:", err));

process.on("unhandledRejection", err => console.log("⚠ unhandledRejection:", err));
process.on("uncaughtException", err => console.log("⚠ uncaughtException:", err));
