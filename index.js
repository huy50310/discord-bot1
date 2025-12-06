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
const { GoogleGenerativeAI } = require("@google/generative-ai");


// =========================================
// LOAD COOKIE YOUTUBE (CÓ THỂ BỎ QUA)
// =========================================
(async () => {
  try {
    const cookies = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
    await play.setToken({
      youtube: { cookie: cookies.cookie }
    });
    console.log("🍪 Loaded YouTube cookies!");
  } catch (e) {
    console.log("⚠️ Không có cookies hoặc lỗi cookie.");
  }
})();


// =========================================
// CONFIG
// =========================================
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


// =========================================
// AI ENGINE
// =========================================
const PRIMARY_MODEL = "gemini-2.5-flash-lite";
const SECOND_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-pro-latest";

const userChatHistory = new Map();

async function tryModel(model, h, p) {
  return await genAI.getGenerativeModel({ model }).generateContent({
    contents: [
      ...h,
      { role: "user", parts: [{ text: p }] }
    ]
  });
}

async function runGemini(uid, prompt) {
  try {
    if (!userChatHistory.has(uid)) {
      userChatHistory.set(uid, [
        { role: "user", parts: [{ text: "Hãy trả lời thân thiện, giống người thật." }] }
      ]);
    }

    const history = userChatHistory.get(uid).slice(-8);
    let result;

    try { result = await tryModel(PRIMARY_MODEL, history, prompt); }
    catch { }

    if (!result) try { result = await tryModel(SECOND_MODEL, history, prompt); }
    catch { }

    if (!result) try { result = await tryModel(FALLBACK_MODEL, history, prompt); }
    catch { return "❌ AI quá tải, thử lại sau."; }

    const reply = result.response.text();
    userChatHistory.get(uid).push(
      { role: "user", parts: [{ text: prompt }] },
      { role: "model", parts: [{ text: reply }] }
    );

    return reply;

  } catch (e) {
    console.error(e);
    return "❌ Lỗi AI.";
  }
}


// =========================================
// MUSIC SYSTEM V3 (ổn định nhất)
// =========================================

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


// ------------------------------
// FIX QUAN TRỌNG: CHUẨN HÓA URL
// ------------------------------
function convertYouTubeURL(url) {
  try {
    let id = null;

    if (url.includes("shorts/"))
      id = url.split("shorts/")[1].split(/[?&]/)[0];

    else if (url.includes("youtu.be/"))
      id = url.split("youtu.be/")[1].split(/[?&]/)[0];

    else if (url.includes("embed/"))
      id = url.split("embed/")[1].split(/[?&]/)[0];

    else if (url.includes("watch?v="))
      id = url.split("watch?v=")[1].split(/[?&]/)[0];

    else if (url.includes("music.youtube.com/watch"))
      id = new URL(url).searchParams.get("v");

    if (!id) return null;

    return `https://www.youtube.com/watch?v=${id}`;
  } catch {
    return null;
  }
}


// ------------------------------
// PLAY NEXT SONG
// ------------------------------
async function playNext(gid) {
  const q = getQueue(gid);
  if (!q.list.length) {
    q.playing = false;

    if (q.timeout) clearTimeout(q.timeout);
    q.timeout = setTimeout(() => {
      if (q.conn) q.conn.destroy();
      queues.delete(gid);
    }, 120000);

    if (q.text) q.text.send("📭 Hết nhạc! Bot sẽ rời voice sau 2 phút.");
    return;
  }

  const song = q.list[0];

  try {
    console.log("▶ STREAM:", song.url);

    const s = await play.stream(song.url);
    const resource = createAudioResource(s.stream, { inputType: s.type });

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


// ------------------------------
// ADD SONG (V3 – fixed 100%)
// ------------------------------
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
      adapterCreator: msg.guild.voiceAdapterCreator,
    });

    q.conn.subscribe(q.player);

    q.player.on(AudioPlayerStatus.Idle, () => {
      q.list.shift();
      playNext(gid);
    });
  }

  let finalURL = null;

  try {
    // User gửi URL
    if (query.startsWith("http")) {
      finalURL = convertYouTubeURL(query);

      if (!finalURL)
        return msg.reply("❌ Link YouTube không hợp lệ.");
    }

    // User search
    else {
      const r = await play.search(query, { limit: 1 });
      if (!r.length) return msg.reply("❌ Không tìm thấy bài.");

      finalURL = convertYouTubeURL(r[0].url);
      if (!finalURL) return msg.reply("❌ Không thể xử lý link tìm kiếm.");
    }

    // Lấy metadata
    const meta = await play.search(finalURL, { limit: 1 });

    const song = {
      title: meta[0]?.title || "Unknown",
      url: finalURL,
      duration: meta[0]?.durationRaw || "?"
    };

    q.list.push(song);
    msg.reply(`➕ Đã thêm: **${song.title}**`);

    if (!q.playing) playNext(gid);

  } catch (e) {
    console.log("ERR addSong:", e);
    return msg.reply("❌ Lỗi khi thêm bài.");
  }
}


// =========================================
// BOT READY
// =========================================
client.once(Events.ClientReady, (c) => {
  console.log(`Bot Online: ${c.user.tag}`);

  client.user.setPresence({
    status: "online",
    activities: [{ name: "🎶 Music + 🤖 AI", type: 4 }]
  });
});


// =========================================
// MESSAGE HANDLER
// =========================================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.inGuild() || msg.author.bot) return;

  const content = msg.content;
  const isAdmin = msg.member.permissions.has("Administrator");

  // MUSIC COMMANDS
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();
    const gid = msg.guild.id;
    const q = getQueue(gid);

    try {
      switch (cmd) {
        case "play":
          if (!args.length) return msg.reply("❌ Dùng: !play <tên bài hoặc link>");
          await addSong(msg, args.join(" "));
          break;

        case "skip":
          q.list.shift();
          msg.reply("⏭ Skip!");
          playNext(gid);
          break;

        case "stop":
          q.list = [];
          q.player.stop();
          const conn = getVoiceConnection(gid);
          if (conn) conn.destroy();
          queues.delete(gid);
          msg.reply("🛑 Đã dừng nhạc & rời voice.");
          break;

        case "queue":
          if (!q.list.length) return msg.reply("📭 Queue trống.");
          msg.reply(
            q.list
              .map((s, i) => `${i === 0 ? "🎧 Đang phát:" : `${i}.`} ${s.title}`)
              .join("\n")
          );
          break;
      }
    } catch (e) {
      console.log("CMD ERR:", e);
      msg.reply("❌ Lỗi xử lý command.");
    }
  }

  // Mention bot → AI
  if (msg.mentions.users.has(client.user.id)) {
    const ask = msg.content.replace(/<@!?(\d+)>/g, "").trim();
    if (!ask) return msg.reply("🤖 Bạn muốn hỏi gì?");
    const reply = await runGemini(msg.author.id, ask);
    msg.reply(reply);
  }
});


// =========================================
// LOGIN
// =========================================
client.login(TOKEN);
