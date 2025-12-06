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
    console.log("⚠ No youtube-cookies.json found.");
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
      { role: "user", parts: [{ text: "Hãy trả lời tự nhiên, giống người thật." }] }
    ]);
  }

  const history = historyMap.get(uid).slice(-8);

  async function ask(model) {
    try {
      const m = genAI.getGenerativeModel({ model });
      return await m.generateContent({
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

  if (!res) return "❌ AI đang quá tải.";

  const output = res.response.text();
  historyMap.get(uid).push(
    { role: "user", parts: [{ text }] },
    { role: "model", parts: [{ text: output }] }
  );

  return output;
}

// ================================
// MUSIC ENGINE (NO PLAYLIST VERSION)
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

    q.text?.send("📭 Hết nhạc! Bot sẽ rời voice sau 2 phút.");
    return;
  }

  const song = q.list[0];

  try {
    const s = await play.stream(song.url).catch(() => null);
    if (!s) {
      q.list.shift();
      return playNext(guildId);
    }

    const resource = createAudioResource(s.stream, { inputType: s.type });
    q.player.play(resource);
    q.playing = true;

    q.text?.send(`▶️ **${song.title}** (${song.duration || "?"})`);
  } catch (e) {
    console.log("Stream error:", e);
    q.list.shift();
    playNext(guildId);
  }
}

async function addSong(msg, query) {
  const guildId = msg.guild.id;
  const q = getQueue(guildId);

  if (!msg.member.voice.channel)
    return msg.reply("❌ Bạn phải vào voice channel!");

  q.text = msg.channel;
  q.voice = msg.member.voice.channel;

  // Tạo kết nối voice nếu chưa có
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

    // ❌ CHẶN PLAYLIST HOÀN TOÀN
    if (type === "playlist") {
      return msg.reply("❌ Bot KHÔNG hỗ trợ playlist. Hãy gửi video lẻ.");
    }

    // 🎵 VIDEO LẺ
    if (type === "video") {
      const info = await play.video_info(query).catch(() => null);
      if (!info) return msg.reply("❌ Không tải được video.");

      items.push({
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      });

      msg.reply(`➕ Đã thêm: **${info.video_details.title}**`);
    }

    // 🔍 SEARCH
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
    console.log("ERR addSong:", err);
    return msg.reply("❌ Lỗi khi xử lý bài hát.");
  }

  items = items.filter(x => x.url);
  if (!items.length) return msg.reply("❌ Không có URL hợp lệ.");

  q.list.push(...items);

  if (!q.playing) playNext(guildId);
}

// ================================
// READY
// ================================
client.on(Events.ClientReady, c => {
  console.log("Bot logged in as:", c.user.tag);

  function update() {
    const arr = ["nhạc 🎶", "AI 💛", "Gemini 🤖", "chill 😎"];
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

  // =====================
  // PREFIX COMMANDS
  // =====================
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
        return msg.reply("🛑 Đã dừng nhạc.");
      }
      if (cmd === "pause") return q.player.pause(), msg.reply("⏸ Tạm dừng.");
      if (cmd === "resume") return q.player.unpause(), msg.reply("▶️ Tiếp tục.");
      if (cmd === "queue") {
        if (!q.list.length) return msg.reply("📭 Queue trống.");
        return msg.reply(
          q.list.map((s, i) => `${i === 0 ? "🎵 Đang phát" : i + "."} – ${s.title}`).join("\n")
        );
      }

      // Admin
      if (cmd === "ban") {
        if (!isAdmin) return msg.reply("❌ Không phải admin.");
        const m = msg.mentions.members.first();
        if (!m) return msg.reply("Tag người để ban.");
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

  // =====================
  // AI CHAT via Mention
  // =====================
  if (msg.mentions.users.has(client.user.id)) {
    const txt = content.replace(`<@${client.user.id}>`, "").trim();
    const reply = await aiRun(msg.author.id, txt || "Hello?");
    return msg.reply(reply);
  }
});

// ================================
// LOGIN
// ================================
client.login(TOKEN);
