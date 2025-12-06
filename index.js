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
  AudioPlayerStatus
} = require("@discordjs/voice");

const play = require("play-dl");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");


// ========================
// LOAD YOUTUBE COOKIES
// ========================
(async () => {
  try {
    const cookies = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
    await play.setToken({
      youtube: {
        cookie: cookies.cookie
      }
    });
    console.log("🍪 YouTube cookies loaded!");
  } catch (e) {
    console.log("⚠️ Không tìm thấy youtube-cookies.json hoặc cookie lỗi.");
  }
})();


// ========================
// CONFIG
// ========================
const PREFIX = process.env.PREFIX || "!";
const TOKEN = process.env.TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});


// ========================
// GEMINI AI
// ========================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY = "gemini-2.5-flash-lite";
const SECOND = "gemini-2.5-flash";
const FALLBACK = "gemini-pro-latest";

const userHistory = new Map();

async function tryCall(model, history, prompt) {
  const m = genAI.getGenerativeModel({ model });
  return m.generateContent({
    contents: [...history, { role: "user", parts: [{ text: prompt }] }]
  });
}

async function runGemini(uid, prompt) {
  try {
    if (!userHistory.has(uid)) {
      userHistory.set(uid, [
        { role: "user", parts: [{ text: "Hãy trả lời thân thiện như người thật." }] }
      ]);
    }

    const his = userHistory.get(uid).slice(-10);
    let result;

    try { result = await tryCall(PRIMARY, his, prompt); } catch {}
    if (!result) try { result = await tryCall(SECOND, his, prompt); } catch {}
    if (!result) try { result = await tryCall(FALLBACK, his, prompt); } catch {}

    if (!result) return "❌ AI đang quá tải.";

    const text = result.response.text();

    his.push({ role: "user", parts: [{ text: prompt }] });
    his.push({ role: "model", parts: [{ text }] });

    userHistory.set(uid, his);

    return text;

  } catch {
    return "❌ Lỗi AI.";
  }
}


// ========================
// MUSIC QUEUE
// ========================
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


// ========================
// CONVERT YOUTUBE URL
// ========================
function convertYouTubeURL(url) {
  try {
    if (url.includes("shorts/")) {
      const id = url.split("shorts/")[1].split("?")[0];
      return `https://www.youtube.com/watch?v=${id}`;
    }

    if (url.includes("youtu.be/")) {
      const id = url.split("youtu.be/")[1].split("?")[0];
      return `https://www.youtube.com/watch?v=${id}`;
    }

    if (url.includes("embed/")) {
      const id = url.split("embed/")[1].split("?")[0];
      return `https://www.youtube.com/watch?v=${id}`;
    }

    if (url.includes("music.youtube.com")) {
      const id = new URL(url).searchParams.get("v");
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    if (url.includes("watch?v=")) return url;

    return null;

  } catch {
    return null;
  }
}


// ========================
// PLAY NEXT SONG
// ========================
async function playNext(gid) {
  const q = queues.get(gid);

  if (!q || q.list.length === 0) {
    q.playing = false;

    if (q.timeout) clearTimeout(q.timeout);
    q.timeout = setTimeout(() => {
      q.conn?.destroy();
      queues.delete(gid);
    }, 120000);

    q.text?.send("📭 Hết nhạc! Bot sẽ rời sau 2 phút.");
    return;
  }

  const song = q.list[0];

  try {
    if (!song.url) {
      q.text?.send("❌ URL lỗi, bỏ bài.");
      q.list.shift();
      return playNext(gid);
    }

    let stream;

    try {
      stream = await play.stream(song.url, {
        discordPlayerCompatibility: true,
        quality: 2
      });
    } catch (e) {
      console.log("STREAM FAIL:", e);
      q.text?.send("❌ Không thể phát audio.");
      q.list.shift();
      return playNext(gid);
    }

    if (!stream?.stream) {
      q.text?.send("❌ Không lấy được stream audio.");
      q.list.shift();
      return playNext(gid);
    }

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });

    q.player.play(resource);
    q.playing = true;

    q.text?.send(`🎶 Đang phát: **${song.title}**`);

  } catch (e) {
    console.log("FATAL STREAM ERR:", e);
    q.list.shift();
    playNext(gid);
  }
}


// ========================
// ADD SONG (WITH URL CONVERT)
// ========================
async function addSong(msg, query) {
  const gid = msg.guild.id;
  const q = getQueue(gid);

  const vc = msg.member.voice.channel;
  if (!vc) return msg.reply("❌ Vào voice trước.");

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

  let song;

  try {
    const type = play.yt_validate(query);

    if (type === "playlist")
      return msg.reply("❌ Bot không hỗ trợ playlist.");

    // 🎬 VIDEO LINK
    if (type === "video") {
      const fixed = convertYouTubeURL(query);
      if (!fixed) return msg.reply("❌ Link YouTube không hợp lệ.");

      const id = play.extractID(fixed);
      if (!id) return msg.reply("❌ Không trích xuất được ID video.");

      const url = `https://www.youtube.com/watch?v=${id}`;
      const r = await play.search(id, { limit: 1 });

      song = {
        title: r?.[0]?.title || "Unknown",
        url,
        duration: r?.[0]?.durationRaw || "?"
      };
    }

    // 🔍 SEARCH
    else {
      const r = await play.search(query, { limit: 1 });
      if (!r.length) return msg.reply("❌ Không tìm thấy bài.");

      song = {
        title: r[0].title,
        url: r[0].url,
        duration: r[0].durationRaw || "?"
      };
    }

  } catch (e) {
    console.log("ADDSONG ERR:", e);
    return msg.reply("❌ Lỗi khi thêm nhạc.");
  }

  if (!song?.url) {
    msg.reply("❌ URL không hợp lệ.");
    return;
  }

  q.list.push(song);
  msg.reply(`➕ Đã thêm: **${song.title}**`);

  if (!q.playing) playNext(gid);
}


// ========================
// BOT READY
// ========================
client.once(Events.ClientReady, () => {
  console.log(`Bot Online: ${client.user.tag}`);
});


// ========================
// MESSAGE COMMANDS
// ========================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.inGuild() || msg.author.bot) return;

  const content = msg.content;
  const gid = msg.guild.id;
  const q = getQueue(gid);
  const isAdmin = msg.member.permissions.has("Administrator");

  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    try {
      switch (cmd) {
        case "play":
          if (!args.length) return msg.reply("❌ Dùng: !play <link hoặc tên>");
          addSong(msg, args.join(" "));
          break;

        case "skip":
          q.list.shift();
          playNext(gid);
          msg.reply("⏭ Skip bài.");
          break;

        case "stop":
          q.player.stop();
          q.conn?.destroy();
          queues.delete(gid);
          msg.reply("🛑 Đã dừng.");
          break;

        case "queue":
          if (!q.list.length) return msg.reply("📭 Queue trống.");
          msg.reply(q.list.map((s, i) =>
            `${i === 0 ? "🎵" : `${i}.`} ${s.title}`).join("\n"));
          break;

        case "pause":
          q.player.pause();
          msg.reply("⏸ Đã tạm dừng.");
          break;

        case "resume":
          q.player.unpause();
          msg.reply("▶ Tiếp tục.");
          break;

        case "shutdown":
          if (!isAdmin) return msg.reply("❌ Không có quyền.");
          msg.reply("🔌 Bot tắt...");
          process.exit(0);
      }
    } catch (e) {
      console.log("CMD ERR:", e);
      msg.reply("❌ Lỗi thực thi command.");
    }

    return;
  }

  // AI CHAT
  if (msg.mentions.users.has(client.user.id)) {
    const t = content.replace(`<@${client.user.id}>`, "").trim();
    const rp = await runGemini(msg.author.id, t);
    return msg.reply(rp);
  }
});


// LOGIN
client.login(TOKEN);
