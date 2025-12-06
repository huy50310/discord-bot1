require("dotenv").config();
const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus
} = require("@discordjs/voice");

const play = require("play-dl");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// =========================================
// CONFIG
// =========================================
const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Load cookies nếu có
(async () => {
  try {
    const ck = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
    await play.setToken({ youtube: { cookie: ck.cookie } });
    console.log("🍪 Cookies YouTube loaded!");
  } catch {
    console.log("⚠ No YouTube cookies found.");
  }
})();

// =========================================
// CLIENT
// =========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// =========================================
// AI ENGINE – Gemini Compact
// =========================================
const MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-pro-latest"
];

const chatHistory = new Map();

async function runAI(uid, prompt) {
  if (!chatHistory.has(uid)) {
    chatHistory.set(uid, [
      {
        role: "user",
        parts: [{ text: "Hãy trả lời thân thiện và có cảm xúc." }]
      }
    ]);
  }

  const history = chatHistory.get(uid).slice(-8);

  let result = null;
  for (const m of MODELS) {
    try {
      console.log("AI MODEL →", m);
      const model = genAI.getGenerativeModel({ model: m });

      result = await model.generateContent({
        contents: [...history, { role: "user", parts: [{ text: prompt }] }]
      });

      break;
    } catch (e) {
      console.log(`⚠ Model ${m} lỗi → thử model tiếp theo`);
    }
  }

  if (!result) return "❌ AI đang quá tải.";

  const output = result.response.text();
  history.push({ role: "user", parts: [{ text: prompt }] });
  history.push({ role: "model", parts: [{ text: output }] });

  chatHistory.set(uid, history);
  return output;
}

// =========================================
// MUSIC ENGINE – TỐI ƯU NHẠC 100%
// =========================================
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      text: null,
      voice: null,
      conn: null,
      player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } }),
      list: [],
      playing: false,
      timeout: null
    });
  }
  return queues.get(guildId);
}

// Tối ưu playNext → đảm bảo **có tiếng**
async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || !q.list.length) {
    q.playing = false;

    if (q.timeout) clearTimeout(q.timeout);
    q.timeout = setTimeout(() => {
      q.conn?.destroy();
      queues.delete(guildId);
    }, 2 * 60 * 1000);

    q.text?.send("📭 Hết nhạc! Bot sẽ rời voice sau 2 phút.");
    return;
  }

  const song = q.list[0];

  try {
    const stream = await play.stream(song.url, {
      quality: 2,                     // ưu tiên audio
      discordPlayerCompatibility: true // đảm bảo tương thích FFmpeg/Opus
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });

    q.player.play(resource);
    q.playing = true;

    q.text?.send(`▶️ Đang phát: **${song.title}**`);

  } catch (err) {
    console.log("STREAM ERROR:", err);
    q.list.shift();
    playNext(guildId);
  }
}

async function addSong(msg, query) {
  const guildId = msg.guild.id;
  const q = getQueue(guildId);

  if (!msg.member.voice.channel)
    return msg.reply("❌ Hãy vào voice channel trước!");

  q.text = msg.channel;
  q.voice = msg.member.voice.channel;

  if (!q.conn) {
    q.conn = joinVoiceChannel({
      channelId: q.voice.id,
      guildId,
      adapterCreator: msg.guild.voiceAdapterCreator
    });

    q.conn.subscribe(q.player);

    q.player.on(AudioPlayerStatus.Idle, () => {
      q.list.shift();
      playNext(guildId);
    });
  }

  let items = [];

  try {
    const type = play.yt_validate(query);

    // ❌ Không hỗ trợ playlist
    if (type === "playlist") {
      return msg.reply("❌ Bot không hỗ trợ playlist. Hãy gửi video lẻ.");
    }

    // VIDEO LẺ
    if (type === "video") {
      const info = await play.video_info(query).catch(() => null);
      if (!info) return msg.reply("❌ Không thể tải video.");

      items.push({
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      });

      msg.reply(`➕ Đã thêm: **${info.video_details.title}**`);
    }

    // SEARCH
    else {
      const r = await play.search(query, { limit: 1 });
      if (!r?.length) return msg.reply("❌ Không tìm thấy bài hát.");

      items.push({
        title: r[0].title,
        url: r[0].url,
        duration: r[0].durationRaw
      });

      msg.reply(`🔍 Tìm thấy: **${r[0].title}**`);
    }

  } catch (err) {
    console.log("ADD SONG ERROR:", err);
    return msg.reply("❌ Lỗi khi xử lý bài hát.");
  }

  q.list.push(...items);

  if (!q.playing) playNext(guildId);
}

// =========================================
// READY
// =========================================
client.on(Events.ClientReady, () => {
  console.log("Bot logged in!");

  const statuses = ["nhạc 🎶", "AI 🤖", "chill 😎", "Gemini 💛"];

  function updateStatus() {
    client.user.setPresence({
      activities: [{ name: statuses[Math.floor(Math.random() * statuses.length)] }]
    });
  }

  updateStatus();
  setInterval(updateStatus, 300000);
});

// =========================================
// MESSAGE HANDLER
// =========================================
client.on(Events.MessageCreate, async msg => {
  if (!msg.inGuild() || msg.author.bot) return;

  const isAdmin = msg.member.permissions.has("Administrator");
  const content = msg.content;
  const args = content.split(/ +/);

  // PREFIX COMMANDS
  if (content.startsWith(PREFIX)) {
    const cmd = args.shift().slice(PREFIX.length).toLowerCase();
    const q = getQueue(msg.guild.id);

    try {
      if (cmd === "play") return addSong(msg, args.join(" "));
      if (cmd === "skip") {
        q.list.shift();
        playNext(msg.guild.id);
        return msg.reply("⏭ Đã skip bài!");
      }
      if (cmd === "stop") {
        q.list = [];
        q.player.stop(true);
        getVoiceConnection(msg.guild.id)?.destroy();
        queues.delete(msg.guild.id);
        return msg.reply("🛑 Đã dừng nhạc.");
      }
      if (cmd === "pause") return q.player.pause(), msg.reply("⏸ Tạm dừng.");
      if (cmd === "resume") return q.player.unpause(), msg.reply("▶️ Tiếp tục.");
      if (cmd === "queue") {
        if (!q.list.length) return msg.reply("📭 Queue trống.");
        return msg.reply(
          q.list.map((s, i) => `${i === 0 ? "🎵 Đang phát:" : `${i}.`} ${s.title}`).join("\n")
        );
      }

      // Admin commands
      if (cmd === "ban") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        const m = msg.mentions.members.first();
        if (!m) return msg.reply("❌ Tag người để ban.");
        await m.ban();
        return msg.reply("🔨 Đã ban.");
      }

      if (cmd === "unban") {
        if (!isAdmin) return msg.reply("❌ Bạn không phải admin.");
        await msg.guild.bans.remove(args[0]);
        return msg.reply("♻️ Đã unban.");
      }

    } catch (err) {
      console.log("CMD ERR:", err);
      return msg.reply("❌ Lỗi command.");
    }
    return;
  }

  // AI CHAT
  if (msg.mentions.users.has(client.user.id)) {
    const text = content.replace(`<@${client.user.id}>`, "").trim();
    const reply = await runAI(msg.author.id, text || "Hello?");
    return msg.reply(reply);
  }
});

// =========================================
// LOGIN
// =========================================
client.login(TOKEN);
