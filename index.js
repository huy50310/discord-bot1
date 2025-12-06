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
// LOAD YOUTUBE COOKIE (optional)
// ============================
(async () => {
  try {
    const cookie = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
    await play.setToken({ youtube: { cookie: cookie.cookie } });
    console.log("🍪 YouTube cookie loaded!");
  } catch {
    console.log("⚠ Không thấy youtube-cookies.json, bỏ qua cookie.");
  }
})();

// ============================
// CONFIG
// ============================
const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================
// CLIENT
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
// GEMINI AI
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
        { role: "user", parts: [{ text: "Hãy trả lời thân thiện, giống người thật." }] }
      ]);
    }

    const h = historyMap.get(uid).slice(-8);
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
    console.log("AI error:", e);
    return "❌ Lỗi AI.";
  }
}

// ============================
// MUSIC QUEUE
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

// chuyển mọi dạng link → watch URL chuẩn
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

// phát bài tiếp theo
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
    console.log("▶ STREAM:", song.url);

    const stream = await play.stream(song.url, { discordPlayerCompatibility: true });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });

    q.player.play(resource);
    q.playing = true;

    q.text?.send(`🎶 Đang phát: **${song.title}** (${song.duration})`);
  } catch (e) {
    console.log("STREAM FAIL:", e);
    q.text?.send("⚠️ Không phát được bài này, skip...");
    q.list.shift();
    playNext(gid);
  }
}

// thêm bài vào queue (đã fix URL / ID)
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

    q.player.removeAllListeners("stateChange");
    q.player.on(AudioPlayerStatus.Idle, () => {
      if (q.playing) {
        q.list.shift();
        playNext(gid);
      }
    });
  }

  let videoId;

  try {
    if (query.startsWith("http")) {
      const fixed = normalizeURL(query);
      if (!fixed) return msg.reply("❌ Link YouTube không hợp lệ.");
      videoId = fixed.split("v=")[1];
    } else {
      const r = await play.search(query, { limit: 1 });
      if (!r.length) return msg.reply("❌ Không tìm thấy bài hát.");
      videoId = r[0].id;
    }

    if (!videoId) return msg.reply("❌ Không lấy được ID video.");

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await play.video_basic_info(url);

    const song = {
      title: info.video_details.title,
      url,
      duration: info.video_details.durationRaw || "?"
    };

    q.list.push(song);
    msg.reply(`➕ Đã thêm: **${song.title}**`);

    if (!q.playing) playNext(gid);
  } catch (e) {
    console.log("addSong error:", e);
    msg.reply("❌ Lỗi khi thêm bài.");
  }
}

// ============================
// AUTO STATUS
// ============================
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot Online: ${c.user.tag}`);

  const statuses = [
    "🎶 !play để nghe nhạc",
    "🤖 Tag tôi để hỏi AI",
    "🎧 Chill với nhạc",
    "🛡 Admin tools ready"
  ];

  const updateStatus = () => {
    const s = statuses[Math.floor(Math.random() * statuses.length)];
    client.user.setPresence({
      status: "online",
      activities: [{ name: s, type: ActivityType.Playing }]
    });
  };

  updateStatus();
  setInterval(updateStatus, 5 * 60 * 1000);
});

// ============================
// ADMIN HELPERS
// ============================
function parseDuration(str) {
  const m = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const v = parseInt(m[1]);
  const u = m[2].toLowerCase();
  return u === "s" ? v * 1000 :
         u === "m" ? v * 60000 :
         u === "h" ? v * 3600000 :
                     v * 86400000;
}

async function adminBan(msg, args) {
  const member = msg.mentions.members.first();
  const reason = args.slice(1).join(" ") || "Không có lý do.";
  if (!member) return msg.reply("⚠ Tag người cần ban.");
  if (!member.bannable) return msg.reply("❌ Không thể ban.");
  await member.ban({ reason });
  return msg.reply(`🔨 Đã ban **${member.user.tag}**\n📝 ${reason}`);
}

async function adminUnban(msg, args) {
  const id = args[0];
  if (!id) return msg.reply("⚠ Nhập user ID.");
  await msg.guild.bans.remove(id).catch(() => {});
  return msg.reply(`♻️ Đã unban ID **${id}**`);
}

async function adminMute(msg, args) {
  const member = msg.mentions.members.first();
  const timeArg = args[1];
  const reason = args.slice(2).join(" ") || "Không có lý do.";
  if (!member) return msg.reply("⚠ Tag người cần mute.");
  if (!timeArg) return msg.reply("⚠ Nhập thời gian: 10s | 5m | 2h | 1d");
  if (!member.moderatable) return msg.reply("❌ Không thể mute.");
  const d = parseDuration(timeArg);
  if (!d) return msg.reply("⚠ Sai định dạng thời gian.");
  await member.timeout(d, reason);
  return msg.reply(`🤐 Đã mute **${member.user.tag}** trong **${timeArg}**`);
}

async function adminUnmute(msg) {
  const member = msg.mentions.members.first();
  if (!member) return msg.reply("⚠ Tag người cần unmute.");
  await member.timeout(null);
  return msg.reply(`🔊 Đã unmute **${member.user.tag}**`);
}

async function adminShutdown(msg) {
  await msg.reply("🔌 Bot đang tắt...");
  console.log("Bot shutdown by admin.");
  process.exit(0);
}

// :L lệnh ẩn
async function handleHiddenCommand(msg, content) {
  const args = content.slice(3).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  await msg.delete().catch(() => {});

  if (!msg.member.permissions.has("Administrator"))
    return msg.channel.send("❌ Bạn không có quyền admin.");

  if (cmd === "ping") return msg.channel.send("🏓 Pong!");

  if (cmd === "say") return msg.channel.send(args.join(" "));

  if (cmd === "announce")
    return msg.channel.send(`📢 **Thông báo:** ${args.join(" ")}`);
}

// ============================
// MESSAGE HANDLER
// ============================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.inGuild() || msg.author.bot) return;

  let content = msg.content || "";
  const gid = msg.guild.id;
  const q = getQueue(gid);
  const isAdmin = msg.member.permissions.has("Administrator");

  // PREFIX
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    try {
      // MUSIC
      if (cmd === "play") {
        if (!args.length) return msg.reply("❌ Dùng: !play <link hoặc tên bài>");
        await addSong(msg, args.join(" "));
      } else if (cmd === "skip") {
        q.list.shift();
        msg.reply("⏭ Đã skip!");
        playNext(gid);
      } else if (cmd === "pause") {
        q.player.pause();
        msg.reply("⏸ Đã tạm dừng.");
      } else if (cmd === "resume") {
        q.player.unpause();
        msg.reply("▶ Đã tiếp tục phát.");
      } else if (cmd === "queue") {
        if (!q.list.length) return msg.reply("📭 Queue trống.");
        msg.reply(
          q.list.map((s, i) =>
            `${i === 0 ? "🎧 Đang phát:" : `${i}.`} ${s.title}`
          ).join("\n")
        );
      } else if (cmd === "stop") {
        q.list = [];
        q.player.stop();
        const conn = getVoiceConnection(gid);
        if (conn) conn.destroy();
        queues.delete(gid);
        msg.reply("🛑 Đã dừng nhạc & rời voice.");
      }

      // ADMIN
      else if (cmd === "ban") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminBan(msg, args);
      } else if (cmd === "unban") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminUnban(msg, args);
      } else if (cmd === "mute") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminMute(msg, args);
      } else if (cmd === "unmute") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminUnmute(msg);
      } else if (cmd === "shutdown") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        return adminShutdown(msg);
      }
    } catch (e) {
      console.log("PREFIX error:", e);
      msg.reply("❌ Lỗi khi xử lý lệnh.");
    }

    return;
  }

  // :L lệnh ẩn
  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    return handleHiddenCommand(msg, content);
  }

  // Mention → admin + AI
  if (msg.mentions.users.has(client.user.id)) {
    let text = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const args = text.split(/ +/);
    const cmd = args.shift()?.toLowerCase();

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

    if (text.length > 0) {
      const reply = await runGemini(msg.author.id, text);
      return msg.reply(reply);
    }

    return msg.reply("🤖 Bạn muốn hỏi gì?");
  }
});

// ============================
// LOGIN + ERROR HANDLERS
// ============================
client.login(TOKEN)
  .then(() => console.log("🔑 Login thành công, bot đang chạy..."))
  .catch(err => {
    console.error("❌ Login lỗi:", err);
    process.exit(1);
  });

process.on("unhandledRejection", (r) => console.log("⚠ unhandledRejection:", r));
process.on("uncaughtException", (e) => console.log("⚠ uncaughtException:", e));
