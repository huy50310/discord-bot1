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
    console.log("⚠️ Không có youtube-cookies.json hoặc cookie lỗi.");
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
// GEMINI AI CONFIG
// ========================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY_MODEL = "gemini-2.5-flash-lite";
const SECOND_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-pro-latest";

const userChatHistory = new Map();

async function tryModel(modelName, history, prompt) {
  const model = genAI.getGenerativeModel({ model: modelName });
  return model.generateContent({
    contents: [...history, { role: "user", parts: [{ text: prompt }] }]
  });
}

async function runGemini(uid, prompt) {
  try {
    if (!userChatHistory.has(uid)) {
      userChatHistory.set(uid, [
        {
          role: "user",
          parts: [{ text: "Hãy trả lời thân thiện, dễ hiểu, giống người thật." }]
        }
      ]);
    }

    const history = userChatHistory.get(uid);
    const slim = history.slice(-10);

    let result;

    try { result = await tryModel(PRIMARY_MODEL, slim, prompt); } catch {}
    if (!result) try { result = await tryModel(SECOND_MODEL, slim, prompt); } catch {}
    if (!result) try { result = await tryModel(FALLBACK_MODEL, slim, prompt); } catch {}

    if (!result) return "❌ AI đang quá tải, thử lại nhé.";

    const text = result.response.text();
    history.push({ role: "user", parts: [{ text: prompt }] });
    history.push({ role: "model", parts: [{ text }] });

    return text;
  } catch (e) {
    console.log("AI ERROR:", e);
    return "❌ Lỗi kết nối AI.";
  }
}

// ========================
// MUSIC QUEUE
// ========================
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
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
  return queues.get(guildId);
}

// ========================
// PLAY NEXT SONG (FIXED)
// ========================
async function playNext(guildId) {
  const q = queues.get(guildId);

  if (!q || q.list.length === 0) {
    q.playing = false;

    if (q.timeout) clearTimeout(q.timeout);
    q.timeout = setTimeout(() => {
      q.conn?.destroy();
      queues.delete(guildId);
    }, 120000);

    q.text?.send("📭 Hết nhạc! Bot sẽ rời voice sau 2 phút.");
    return;
  }

  const song = q.list[0];

  try {
    if (!song.url || typeof song.url !== "string") {
      console.log("BAD URL:", song);
      q.text?.send("❌ Bài này lỗi URL, bỏ qua.");
      q.list.shift();
      return playNext(guildId);
    }

    let stream;

    try {
      stream = await play.stream(song.url, {
        discordPlayerCompatibility: true,
        quality: 2
      });
    } catch (e) {
      console.log("STREAM FAIL:", e);
      q.text?.send("❌ Không thể stream audio.");
      q.list.shift();
      return playNext(guildId);
    }

    if (!stream?.stream) {
      q.text?.send("❌ Không lấy được audio từ video, bỏ qua.");
      q.list.shift();
      return playNext(guildId);
    }

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });

    q.player.play(resource);
    q.playing = true;

    q.text?.send(`🎶 Đang phát: **${song.title}**`);

  } catch (e) {
    console.log("FATAL STREAM:", e);
    q.list.shift();
    playNext(guildId);
  }
}

// ========================
// ADD SONG (FIXED 100% URL)
// ========================
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

  let song;

  try {
    const type = play.yt_validate(query);

    // ❌ Không hỗ trợ playlist – tránh crash
    if (type === "playlist") {
      return msg.reply("❌ Bot không hỗ trợ playlist.");
    }

    // 🎬 VIDEO LINK
    if (type === "video") {
      const id = play.extractID(query);
      if (!id) return msg.reply("❌ Không tìm thấy ID video.");

      const url = `https://www.youtube.com/watch?v=${id}`;
      const result = await play.search(id, { limit: 1 });

      song = {
        title: result?.[0]?.title || "Unknown Title",
        url,
        duration: result?.[0]?.durationRaw || "?"
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
    console.log("ADDSONG ERROR:", e);
    return msg.reply("❌ Không thể xử lý bài này.");
  }

  // 🚨 Chặn lỗi URL undefined
  if (!song?.url || song.url.length < 10) {
    console.log("INVALID SONG:", song);
    return msg.reply("❌ Video này không hỗ trợ hoặc URL lỗi.");
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

  // PREFIX
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    try {
      switch (cmd) {
        case "play":
          if (!args.length) return msg.reply("❌ Dùng: !play <tên hoặc link>");
          addSong(msg, args.join(" "));
          break;

        case "skip":
          q.list.shift();
          playNext(gid);
          msg.reply("⏭ Đã skip.");
          break;

        case "stop":
          q.player.stop();
          q.conn?.destroy();
          queues.delete(gid);
          msg.reply("🛑 Đã dừng nhạc.");
          break;

        case "queue":
          if (!q.list.length) return msg.reply("📭 Queue trống.");
          msg.reply(q.list.map((s, i) => `${i === 0 ? "🎵" : i + "."} ${s.title}`).join("\n"));
          break;

        case "pause":
          q.player.pause();
          msg.reply("⏸ Tạm dừng.");
          break;

        case "resume":
          q.player.unpause();
          msg.reply("▶ Tiếp tục.");
          break;

        case "shutdown":
          if (!isAdmin) return msg.reply("❌ Bạn không có quyền.");
          await msg.reply("🔌 Bot đang tắt...");
          process.exit(0);
      }
    } catch (e) {
      console.log("CMD ERROR:", e);
      msg.reply("❌ Lỗi xử lý command.");
    }

    return;
  }

  // AI MENTION
  if (msg.mentions.users.has(client.user.id)) {
    const text = content.replace(`<@${client.user.id}>`, "").trim();
    if (!text) return msg.reply("Bạn muốn hỏi gì?");
    const output = await runGemini(msg.author.id, text);
    return msg.reply(output);
  }
});

// ========================
// LOGIN
// ========================
client.login(TOKEN);
