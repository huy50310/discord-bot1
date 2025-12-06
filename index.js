// ========================== LOAD LIBSODIUM FIRST ==========================
const sodium = require("libsodium-wrappers");

(async () => {
  await sodium.ready;
  console.log("🔐 Libsodium loaded successfully!");
})();

require("dotenv").config();
const {
  Client, GatewayIntentBits, Partials, Events
} = require("discord.js");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, NoSubscriberBehavior
} = require("@discordjs/voice");

const play = require("play-dl");
const fs = require("fs");

// ===================== LOADING COOKIE YOUTUBE ======================
(async () => {
  try {
    if (fs.existsSync("./youtube-cookies.json")) {
      const ck = JSON.parse(fs.readFileSync("./youtube-cookies.json"));
      await play.setToken({
        youtube: { cookie: ck.cookie }
      });
      console.log("🍪 Cookie YouTube loaded OK");
    } else {
      console.log("⚠️ Không tìm thấy youtube-cookies.json");
    }
  } catch (err) {
    console.log("⚠ Cookie lỗi:", err.message);
  }
})();

// ========================== DISCORD CLIENT ==========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// ========================== QUEUE ==========================
const PREFIX = "!";
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      text: null,
      voice: null,
      conn: null,
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play }
      }),
      songs: [],
      playing: false
    });
  }
  return queues.get(guildId);
}

// ===================== PLAY NEXT SONG ======================
async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q) return;

  if (q.songs.length === 0) {
    q.playing = false;
    if (q.text) q.text.send("📭 Hết nhạc! Bot sẽ rời sau 2 phút…");

    setTimeout(() => {
      if (q.conn) q.conn.destroy();
      queues.delete(guildId);
    }, 120000);
    return;
  }

  const song = q.songs[0];
  try {
    console.log("▶ STREAM:", song.url);

    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });

    q.player.play(resource);
    q.playing = true;

    if (q.text) q.text.send(`🎵 Đang phát: **${song.title}**`);

  } catch (err) {
    console.log("STREAM FAIL:", err);
    q.songs.shift();
    playNext(guildId);
  }
}

// ===================== ADD SONG ======================
async function addSong(msg, query) {
  const q = getQueue(msg.guild.id);
  const vc = msg.member.voice.channel;
  if (!vc) return msg.reply("❌ Bạn phải vào voice trước!");

  q.text = msg.channel;
  q.voice = vc;

  if (!q.conn) {
    q.conn = joinVoiceChannel({
      channelId: vc.id,
      guildId: msg.guild.id,
      adapterCreator: msg.guild.voiceAdapterCreator
    });
    q.conn.subscribe(q.player);

    q.player.on(AudioPlayerStatus.Idle, () => {
      if (q.playing) {
        q.songs.shift();
        playNext(msg.guild.id);
      }
    });
  }

  try {
    let song;

    // URL
    if (query.startsWith("http")) {
      const info = await play.video_basic_info(query);
      song = {
        title: info.video_details.title,
        url: info.video_details.url
      };
    }

    // SEARCH
    else {
      const r = await play.search(query, { limit: 1 });
      if (!r.length) return msg.reply("❌ Không tìm thấy bài hát.");
      song = {
        title: r[0].title,
        url: r[0].url
      };
    }

    q.songs.push(song);
    msg.reply(`➕ Đã thêm: **${song.title}**`);

    if (!q.playing) playNext(msg.guild.id);

  } catch (err) {
    console.log("ADDSONG ERROR:", err);
    msg.reply("❌ Lỗi khi thêm bài.");
  }
}

// ======================= READY + STATUS ======================
client.once(Events.ClientReady, (c) => {
  console.log("Bot Online:", c.user.tag);

  const statuses = [
    "chúc bạn một ngày tốt lành ☀️",
    "nghỉ ngơi giữa trưa 😌",
    "ở đây với bạn 🌙",
    "thức khuya cùng bạn 😴",
    "chill cùng nhạc 🎶"
  ];

  setInterval(() => {
    client.user.setPresence({
      status: "online",
      activities: [
        { name: statuses[Math.floor(Math.random() * statuses.length)], type: 4 }
      ]
    });
  }, 300000);
});

// ========================= MESSAGE CMD =========================
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();
  const q = getQueue(msg.guild.id);
  const isAdmin = msg.member.permissions.has("Administrator");

  switch (cmd) {

    case "play":
      return addSong(msg, args.join(" "));

    case "skip":
      if (!q.playing) return msg.reply("❌ Không có bài nào.");
      q.songs.shift();
      msg.reply("⏭ Skip!");
      return playNext(msg.guild.id);

    case "stop":
      q.songs = [];
      q.playing = false;
      q.player.stop();
      if (q.conn) q.conn.destroy();
      queues.delete(msg.guild.id);
      return msg.reply("🛑 Đã dừng nhạc!");

    case "pause":
      q.player.pause();
      return msg.reply("⏸ Paused!");

    case "resume":
      q.player.unpause();
      return msg.reply("▶ Resume!");

    // =================== ADMIN ===================
    case "ban":
      if (!isAdmin) return msg.reply("❌ Không phải admin.");
      const mem = msg.mentions.members.first();
      if (!mem) return msg.reply("Tag người cần ban.");
      await mem.ban();
      return msg.reply(`🔨 Đã ban ${mem.user.tag}`);

    case "mute":
      if (!isAdmin) return msg.reply("❌ Không phải admin.");
      const m = msg.mentions.members.first();
      if (!m) return msg.reply("Tag người cần mute.");
      await m.timeout(60000, "Mute 1 phút");
      return msg.reply(`🤐 Đã mute ${m.user.tag}`);

    case "unmute":
      if (!isAdmin) return msg.reply("❌ Không phải admin.");
      const u = msg.mentions.members.first();
      if (!u) return msg.reply("Tag người cần unmute.");
      await u.timeout(null);
      return msg.reply(`🔊 Đã unmute ${u.user.tag}`);
  }
});

// ======================= LOGIN =======================
client.login(process.env.TOKEN);

