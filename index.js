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

const { GoogleGenerativeAI } = require("@google/generative-ai");
const ytdlp = require("yt-dlp-exec");
const { Readable } = require("stream");

// ====================================================================
// CONFIG
// ====================================================================
const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY = "gemini-2.5-flash-lite";
const SECOND = "gemini-2.5-flash";
const FALLBACK = "gemini-pro-latest";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});


// ====================================================================
// GEMINI AI
// ====================================================================
const chatHistory = new Map();

async function callGeminiModel(model, history, prompt) {
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

    const hist = chatHistory.get(uid).slice(-8);
    let result;

    try { result = await callGeminiModel(PRIMARY, hist, prompt); } catch {}
    if (!result) try { result = await callGeminiModel(SECOND, hist, prompt); } catch {}
    if (!result) try { result = await callGeminiModel(FALLBACK, hist, prompt); }
      catch { return "❌ AI đang bận, thử lại sau."; }

    const text = result.response.text();
    chatHistory.get(uid).push(
      { role: "user", parts: [{ text: prompt }] },
      { role: "model", parts: [{ text }] }
    );

    return text;

  } catch (e) {
    console.log("AI error:", e);
    return "❌ Lỗi AI.";
  }
}


// ====================================================================
// QUEUE + MUSIC SYSTEM (YT-DLP)
// ====================================================================
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

// CHUYỂN MỌI LINK → WATCH URL
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

// LẤY STREAM BẰNG YT-DLP (KHÔNG BAO GIỜ LỖI)
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
      const conn = getVoiceConnection(gid);
      if (conn) conn.destroy();
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
    console.log("STREAM FAIL:", e);
    q.text?.send("⚠️ Lỗi phát nhạc → Skip");
    q.list.shift();
    return playNext(gid);
  }
}

// THÊM BÀI
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

  let fixedURL = query.startsWith("http")
    ? normalizeURL(query)
    : null;

  if (!fixedURL) {
    // search
    const ytdlpSearch = await ytdlp(query, {
      dumpSingleJson: true,
      defaultSearch: "ytsearch",
      quiet: true
    });

    if (!ytdlpSearch || !ytdlpSearch.entries || !ytdlpSearch.entries.length)
      return msg.reply("❌ Không tìm thấy bài hát nào.");

    fixedURL = `https://www.youtube.com/watch?v=${ytdlpSearch.entries[0].id}`;
  }

  // lấy thông tin bài
  const info = await ytdlp(fixedURL, { dumpSingleJson: true, quiet: true });

  const song = {
    title: info.title,
    url: fixedURL,
    duration: info.duration_string || "?"
  };

  q.list.push(song);
  msg.reply(`➕ Đã thêm: **${song.title}**`);

  if (!q.playing) playNext(gid);
}


// ====================================================================
// STATUS
// ====================================================================
client.once(Events.ClientReady, () => {
  console.log(`💚 Bot Online: ${client.user.tag}`);

  const statuses = [
    "🎶 Nhạc không lỗi",
    "🤖 Chat AI",
    "🛡 Admin tools",
  ];

  const updateStatus = () => {
    const text = statuses[Math.floor(Math.random() * statuses.length)];
    client.user.setPresence({
      status: "online",
      activities: [{ name: text, type: ActivityType.Playing }]
    });
  };

  updateStatus();
  setInterval(updateStatus, 5 * 60 * 1000);
});


// ====================================================================
// ADMIN UTILS
// ====================================================================
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
  if (!m.bannable) return msg.reply("❌ Không thể ban.");

  const reason = args.slice(1).join(" ") || "Không có lý do";
  await m.ban({ reason });
  return msg.reply(`🔨 Ban: **${m.user.tag}**`);
}

async function adminUnban(msg, args) {
  const id = args[0];
  if (!id) return msg.reply("⚠ Nhập userId");
  await msg.guild.bans.remove(id).catch(() => {});
  return msg.reply(`♻ Unban: **${id}**`);
}

async function adminMute(msg, args) {
  const m = msg.mentions.members.first();
  if (!m) return msg.reply("⚠ Tag người cần mute");
  if (!m.moderatable) return msg.reply("❌ Không thể mute");

  const dur = parseDuration(args[1]);
  if (!dur) return msg.reply("⚠ Sai thời gian. VD: 10s 5m 2h");

  const reason = args.slice(2).join(" ") || "Không có lý do";
  await m.timeout(dur, reason);
  return msg.reply(`🤐 Mute **${m.user.tag}** ${args[1]}`);
}

async function adminUnmute(msg) {
  const m = msg.mentions.members.first();
  if (!m) return msg.reply("⚠ Tag người cần unmute");
  await m.timeout(null);
  return msg.reply(`🔊 Unmute **${m.user.tag}**`);
}


// ====================================================================
// MESSAGE HANDLER
// ====================================================================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.inGuild() || msg.author.bot) return;

  const gid = msg.guild.id;
  const content = msg.content;
  const isAdmin = msg.member.permissions.has("Administrator");

  // PREFIX COMMANDS
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    try {
      if (cmd === "play") {
        if (!args.length) return msg.reply("❌ !play <bài hát>");
        await addSong(msg, args.join(" "));
      }

      else if (cmd === "skip") {
        const q = getQueue(gid);
        q.list.shift();
        msg.reply("⏭ Skip!");
        playNext(gid);
      }

      else if (cmd === "pause") {
        getQueue(gid).player.pause();
        msg.reply("⏸ Pause");
      }

      else if (cmd === "resume") {
        getQueue(gid).player.unpause();
        msg.reply("▶ Resume");
      }

      else if (cmd === "stop") {
        const q = getQueue(gid);
        q.list = [];
        q.player.stop();
        const conn = getVoiceConnection(gid);
        if (conn) conn.destroy();
        queues.delete(gid);
        msg.reply("🛑 Đã dừng & rời voice.");
      }

      else if (cmd === "queue") {
        const q = getQueue(gid);
        if (!q.list.length) return msg.reply("📭 Queue trống.");
        msg.reply(q.list.map((s, i) =>
          `${i === 0 ? "🎧 Đang phát:" : i + "."} ${s.title}`
        ).join("\n"));
      }

      // ADMIN
      else if (cmd === "ban") {
        if (!isAdmin) return msg.reply("❌ Không phải admin");
        return adminBan(msg, args);
      }

      else if (cmd === "unban") {
        if (!isAdmin) return msg.reply("❌ Không phải admin");
        return adminUnban(msg, args);
      }

      else if (cmd === "mute") {
        if (!isAdmin) return msg.reply("❌ Không phải admin");
        return adminMute(msg, args);
      }

      else if (cmd === "unmute") {
        if (!isAdmin) return msg.reply("❌ Không phải admin");
        return adminUnmute(msg);
      }

    } catch (e) {
      console.log("CMD ERROR:", e);
      msg.reply("❌ Lỗi xử lý lệnh.");
    }

    return;
  }

  // AI MENTION
  if (msg.mentions.users.has(client.user.id)) {
    let text = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    if (!text) return msg.reply("🤖 Bạn muốn hỏi gì?");

    const ans = await runGemini(msg.author.id, text);
    return msg.reply(ans);
  }
});


// ====================================================================
// LOGIN + ERROR HANDLER
// ====================================================================
client.login(TOKEN)
  .then(() => console.log("🔑 Bot đã login!"))
  .catch(err => console.log("❌ Login fail:", err));

process.on("unhandledRejection", err => console.log("⚠ unhandledRejection:", err));
process.on("uncaughtException", err => console.log("⚠ uncaughtException:", err));
