require("dotenv").config();
const fs = require("fs");
const { exec } = require("child_process");

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

// ================================
// CONFIG
// ================================
const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Load YouTube cookies
(async () => {
  try {
    const ck = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
    await play.setToken({ youtube: { cookie: ck.cookie } });
    console.log("🍪 Cookies YouTube loaded!");
  } catch {
    console.log("⚠ No cookies file.");
  }
})();

// ================================
// CLIENT
// ================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// ================================
// AI ENGINE (Compact)
// ================================
const MODEL_1 = "gemini-2.5-flash-lite";
const MODEL_2 = "gemini-2.5-flash";
const MODEL_3 = "gemini-pro-latest";

const historyMap = new Map();

async function aiRun(uid, text) {
  if (!historyMap.has(uid)) {
    historyMap.set(uid, [
      { role: "user", parts: [{ text: "Hãy trả lời tự nhiên, giàu cảm xúc." }] }
    ]);
  }

  const history = historyMap.get(uid).slice(-8);
  async function ask(modelName) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      return await model.generateContent({
        contents: [...history, { role: "user", parts: [{ text }] }]
      });
    } catch {
      return null;
    }
  }

  const res =
    (await ask(MODEL_1)) ||
    (await ask(MODEL_2)) ||
    (await ask(MODEL_3));

  if (!res) return "❌ AI quá tải.";

  const output = res.response.text();
  historyMap.get(uid).push(
    { role: "user", parts: [{ text }] },
    { role: "model", parts: [{ text: output }] }
  );

  return output;
}

// ================================
// FULL PLAYLIST ENGINE (yt-dlp)
// ================================
function getFullPlaylist(url) {
  return new Promise((resolve, reject) => {
    exec(`yt-dlp --flat-playlist -J "${url}"`, (err, stdout) => {
      if (err) return reject(err);

      try {
        const data = JSON.parse(stdout);
        const entries = data.entries || [];

        const videos = entries.map(v => ({
          title: v.title,
          url: `https://www.youtube.com/watch?v=${v.id}`
        }));

        resolve({
          title: data.title || "Playlist",
          videos
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ================================
// MUSIC ENGINE
// ================================
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      text: null,
      voice: null,
      conn: null,
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
      }),
      list: [],
      playing: false,
      timeout: null
    });
  }
  return queues.get(guildId);
}

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || !q.list.length) {
    q.playing = false;

    if (q.timeout) clearTimeout(q.timeout);
    q.timeout = setTimeout(() => {
      q.conn?.destroy();
      queues.delete(guildId);
    }, 2 * 60 * 1000);

    q.text?.send("📭 Hết nhạc! Bot rời voice sau 2 phút.");
    return;
  }

  const song = q.list[0];
  if (!song.url) {
    q.list.shift();
    return playNext(guildId);
  }

  try {
    const s = await play.stream(song.url).catch(() => null);
    if (!s) {
      q.list.shift();
      return playNext(guildId);
    }

    const resource = createAudioResource(s.stream, { inputType: s.type });
    q.player.play(resource);
    q.playing = true;

    q.text?.send(`▶️ **${song.title}**`);
  } catch (e) {
    console.log("ERR stream:", e);
    q.list.shift();
    playNext(guildId);
  }
}

async function addSong(msg, query) {
  const guildId = msg.guild.id;
  const q = getQueue(guildId);

  if (!msg.member.voice.channel)
    return msg.reply("❌ Bạn phải vào voice!");

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

    // ==============================
    // 🎵 VIDEO
    // ==============================
    if (type === "video") {
      const info = await play.video_info(query).catch(() => null);
      if (!info) return msg.reply("❌ Video lỗi.");

      items.push({
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      });

      msg.reply(`➕ Thêm: **${info.video_details.title}**`);
    }

    // ==============================
    // 📃 FULL PLAYLIST (yt-dlp)
    // ==============================
    else if (type === "playlist") {
      msg.reply("📥 Đang tải FULL PLAYLIST…");

      const data = await getFullPlaylist(query).catch(() => null);
      if (!data) return msg.reply("❌ Playlist lỗi.");

      items = data.videos.map(v => ({
        title: v.title,
        url: v.url,
        duration: "?"
      }));

      msg.reply(`📃 Playlist **${data.title}** → Thêm **${items.length} bài**`);
    }

    // ==============================
    // 🔍 SEARCH
    // ==============================
    else {
      const r = await play.search(query, { limit: 1 });
      if (!r?.length) return msg.reply("❌ Không tìm thấy bài.");

      items.push({
        title: r[0].title,
        url: r[0].url,
        duration: r[0].durationRaw
      });

      msg.reply(`🔍 Thêm: **${r[0].title}**`);
    }

  } catch (err) {
    console.log("ERR addSong:", err);
    return msg.reply("❌ Lỗi tải bài.");
  }

  items = items.filter(x => x.url);
  if (!items.length) return msg.reply("❌ Không có URL hợp lệ.");

  q.list.push(...items);

  if (!q.playing) playNext(guildId);
}

// ================================
// READY + STATUS
// ================================
client.on(Events.ClientReady, c => {
  console.log("Đăng nhập:", c.user.tag);

  function update() {
    const arr = ["nhạc 🎶", "AI 💛", "chill 😎", "Gemini 🤖"];
    client.user.setPresence({
      activities: [{ name: arr[Math.floor(Math.random() * arr.length)] }]
    });
  }

  update();
  setInterval(update, 300000);
});

// ================================
// MESSAGE HANDLER
// ================================
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
        return msg.reply("⏭ Skip!");
      }
      if (cmd === "stop") {
        q.list = [];
        q.player.stop(true);
        getVoiceConnection(msg.guild.id)?.destroy();
        queues.delete(msg.guild.id);
        return msg.reply("🛑 Dừng.");
      }
      if (cmd === "pause") return q.player.pause(), msg.reply("⏸ Tạm dừng.");
      if (cmd === "resume") return q.player.unpause(), msg.reply("▶️ Tiếp tục.");
      if (cmd === "queue") {
        if (!q.list.length) return msg.reply("📭 Trống.");
        return msg.reply(
          q.list.map((s, i) => `${i === 0 ? "🎵 Đang phát" : i + "."} – ${s.title}`).join("\n")
        );
      }

      if (cmd === "ban") {
        if (!isAdmin) return msg.reply("❌ Không phải admin.");
        const m = msg.mentions.members.first();
        if (!m) return msg.reply("Tag người ban.");
        await m.ban();
        return msg.reply("🔨 Đã ban.");
      }

      if (cmd === "unban") {
        if (!isAdmin) return msg.reply("❌ Không phải admin.");
        await msg.guild.bans.remove(args[0]);
        return msg.reply("♻️ Đã unban.");
      }

    } catch (e) {
      console.log("CMD ERR:", e);
      return msg.reply("❌ Lỗi command.");
    }
    return;
  }

  // AI CHAT (mention)
  if (msg.mentions.users.has(client.user.id)) {
    const txt = content.replace(`<@${client.user.id}>`, "").trim();
    const out = await aiRun(msg.author.id, txt || "Hello?");
    return msg.reply(out);
  }
});

// ================================
// LOGIN
// ================================
client.login(TOKEN);
