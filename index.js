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

// ========================
// LOAD COOKIES YOUTUBE
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
// GEMINI AI CONFIG
// ========================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY_MODEL = "gemini-2.5-flash-lite";
const SECOND_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-pro-latest";

const userChatHistory = new Map();

async function tryModel(modelName, history, prompt) {
  const m = genAI.getGenerativeModel({ model: modelName });
  return m.generateContent({
    contents: [...history, { role: "user", parts: [{ text: prompt }] }]
  });
}

async function runGemini(userId, prompt) {
  try {
    if (!userChatHistory.has(userId)) {
      userChatHistory.set(userId, [
        {
          role: "user",
          parts: [{ text: "Hãy trả lời thân thiện như người thật." }]
        }
      ]);
    }

    const history = userChatHistory.get(userId);
    const slim = history.slice(-8);
    let res;

    try {
      res = await tryModel(PRIMARY_MODEL, slim, prompt);
    } catch {}

    if (!res) {
      try {
        res = await tryModel(SECOND_MODEL, slim, prompt);
      } catch {}
    }

    if (!res) {
      try {
        res = await tryModel(FALLBACK_MODEL, slim, prompt);
      } catch {
        return "❌ AI đang quá tải.";
      }
    }

    const result = res.response.text();
    history.push({ role: "user", parts: [{ text: prompt }] });
    history.push({ role: "model", parts: [{ text: result }] });

    return result;
  } catch {
    return "❌ Lỗi AI.";
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
// PLAY NEXT SONG
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
    if (!song.url) {
      q.text?.send("❌ URL lỗi. Bỏ bài.");
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
      console.log("STREAM FAIL 1:", e);
      return q.text?.send("❌ Không thể stream audio.");
    }

    if (!stream?.stream) {
      q.text?.send("❌ Stream lỗi. Bỏ qua bài.");
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
    console.log("STREAM ERROR:", e);
    q.list.shift();
    playNext(guildId);
  }
}

// ========================
// ADD SONG (NO PLAYLIST)
// ========================
async function addSong(msg, query) {
  const guildId = msg.guild.id;
  const q = getQueue(guildId);

  const vc = msg.member.voice.channel;
  if (!vc) return msg.reply("❌ Vào voice trước.");

  q.text = msg.channel;
  q.voice = vc;

  if (!q.conn) {
    q.conn = joinVoiceChannel({
      channelId: vc.id,
      guildId,
      adapterCreator: msg.guild.voiceAdapterCreator
    });

    q.conn.subscribe(q.player);

    q.player.on(AudioPlayerStatus.Idle, () => {
      q.list.shift();
      playNext(guildId);
    });
  }

  let song;

  try {
    const type = play.yt_validate(query);

    if (type === "playlist")
      return msg.reply("❌ Không hỗ trợ playlist.");

    if (type === "video") {
      const info = await play.video_info(query);

      song = {
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw || "?"
      };
    } else {
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
    return msg.reply("❌ Không thể thêm bài này.");
  }

  if (!song?.url) return msg.reply("❌ Video không hợp lệ.");

  q.list.push(song);
  msg.reply(`➕ Đã thêm: **${song.title}**`);

  if (!q.playing) playNext(guildId);
}

// ========================
// BOT READY
// ========================
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ========================
// PREFIX COMMANDS
// ========================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.inGuild() || msg.author.bot) return;

  const content = msg.content;
  const isAdmin = msg.member.permissions.has("Administrator");
  const guildId = msg.guild.id;
  const q = getQueue(guildId);

  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    try {
      switch (cmd) {
        case "play":
          if (!args.length) return msg.reply("❌ dùng: !play <tên hoặc link>");
          addSong(msg, args.join(" "));
          break;

        case "skip":
          q.list.shift();
          playNext(guildId);
          msg.reply("⏭ Skip!");
          break;

        case "stop":
          q.player.stop();
          q.conn?.destroy();
          queues.delete(guildId);
          msg.reply("🛑 Đã dừng.");
          break;

        case "queue":
          if (!q.list.length) return msg.reply("📭 Queue trống.");
          msg.reply(
            q.list.map((s, i) => `${i === 0 ? "🎵" : i + "."} ${s.title}`).join("\n")
          );
          break;

        case "pause":
          q.player.pause();
          msg.reply("⏸ Paused.");
          break;

        case "resume":
          q.player.unpause();
          msg.reply("▶ Resume.");
          break;
      }
    } catch (e) {
      console.log("CMD ERR:", e);
      msg.reply("❌ Lỗi command.");
    }
    return;
  }

  // AI
  if (msg.mentions.users.has(client.user.id)) {
    const txt = content.replace(`<@${client.user.id}>`, "").trim();
    if (!txt) return msg.reply("Bạn muốn hỏi gì?");
    const reply = await runGemini(msg.author.id, txt);
    return msg.reply(reply);
  }
});

// LOGIN
client.login(TOKEN);
