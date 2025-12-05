require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CẤU HÌNH GEMINI ---
// Sử dụng bản Flash để phản hồi nhanh và miễn phí/rẻ hơn
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-1.5-flash"; 

// Lưu trữ lịch sử chat: { userId: [ { role: 'user', parts: [...] }, ... ] }
const memory = {};

// ===============================
// DISCORD CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// ====================================================
// PREFIX COMMANDS (:L)
// ====================================================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const content = message.content.trim();
  const isAdmin = message.member.permissions.has("Administrator");

  // -------- PREFIX :L --------
  if (content.startsWith(":L ") || content.startsWith(":l ")) {
    const args = content.slice(3).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (command === "ping") {
      return message.channel.send("🏓 Pong!");
    }

    if (command === "ask") {
      const question = args.join(" ");
      if (!question) return message.reply("❌ Bạn cần nhập câu hỏi. Ví dụ: `:L ask hôm nay trời sao?`");
      return runGemini(message, question);
    }

    // --- Admin commands ---
    if (!isAdmin) return message.reply("❌ Bạn không có quyền admin.");

    if (command === "say") return message.channel.send(args.join(" "));
    if (command === "announce") return message.channel.send(`📢 **Thông báo:** ${args.join(" ")}`);
    
    return;
  }
});

// ====================================================
// ADMIN COMMANDS VIA MENTION & CHAT AI
// ====================================================
client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot) return;

  const isMentioned = message.mentions.users.has(client.user.id);
  const isAdmin = message.member.permissions.has("Administrator");

  if (!isMentioned) return;

  // Lấy nội dung sau khi bỏ mention bot
  const content = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();

  // Nếu chỉ tag bot mà không nói gì -> Hiện menu
  if (!content) {
    return message.reply(
      "🤖 **Menu lệnh:**\n" +
      "🔹 `:L ask <câu hỏi>` — hỏi AI\n" +
      "🔹 Tag bot + câu hỏi — hỏi AI\n" +
      "🔹 Admin: say, announce, ban, unban, mute, unmute"
    );
  }

  // Tách lệnh
  const parts = content.split(/ +/);
  const command = parts.shift()?.toLowerCase();

  // Danh sách lệnh Admin
  const adminCmds = ["say", "announce", "ban", "unban", "mute", "unmute"];
  
  if (adminCmds.includes(command)) {
    if (!isAdmin) return message.reply("❌ Bạn không có quyền.");
    
    // Xử lý từng lệnh admin
    if (command === "say") return message.channel.send(parts.join(" "));
    if (command === "announce") return message.channel.send(`📢 **Thông báo:** ${parts.join(" ")}`);

    if (command === "ban") {
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Tag người cần ban.");
      if (!member.bannable) return message.reply("❌ Không thể ban người này (quyền cao hơn bot).");
      await member.ban({ reason: parts.slice(1).join(" ") || "Không có lý do" });
      return message.reply(`🔨 Đã ban **${member.user.tag}**`);
    }

    if (command === "unban") {
      const id = parts[0];
      if (!id) return message.reply("❌ Nhập user ID.");
      await message.guild.bans.remove(id).catch(() => message.reply("❌ Không thể unban (ID sai hoặc chưa bị ban)."));
      return message.reply(`♻️ Đã unban ID: ${id}`);
    }

    if (command === "mute") {
      const member = message.mentions.members.first();
      const timeArg = parts[1];
      if (!member) return message.reply("❌ Tag người cần mute.");
      if (!timeArg) return message.reply("❌ Nhập thời gian: 10s / 5m / 1h.");
      
      const regex = /^(\d+)(s|m|h|d)$/i;
      const match = timeArg.match(regex);
      if (!match) return message.reply("❌ Sai định dạng thời gian.");

      const num = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] * num;

      await member.timeout(ms).catch(e => message.reply("❌ Lỗi khi mute (có thể quyền bot thấp hơn)."));
      return message.reply(`🤐 Đã mute **${member.user.tag}** trong ${timeArg}`);
    }

    if (command === "unmute") {
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Tag người cần unmute.");
      await member.timeout(null).catch(e => message.reply("❌ Lỗi unmute."));
      return message.reply(`🔊 Đã unmute **${member.user.tag}**`);
    }
    
    return; // Kết thúc nếu là lệnh admin
  }

  // Nếu không phải lệnh Admin -> Chuyển sang chat AI
  // Ở đây 'content' chính là câu hỏi vì ta đã strip mention ở trên
  return runGemini(message, content);
});


// ====================================================
// GEMINI CHAT FUNCTION (ĐÃ SỬA ĐỔI)
// ====================================================
async function runGemini(message, question) {
  const userId = message.author.id;

  // Khởi tạo lịch sử nếu chưa có
  if (!memory[userId]) {
    memory[userId] = [];
  }

  await message.channel.sendTyping();

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Tạo phiên chat với lịch sử hiện có
    const chat = model.startChat({
      history: memory[userId], // Truyền lịch sử đúng định dạng SDK
      generationConfig: {
        maxOutputTokens: 1000, // Giới hạn độ dài câu trả lời
      },
    });

    // Gửi tin nhắn mới
    const result = await chat.sendMessage(question);
    const response = await result.response;
    const text = response.text();

    // Cập nhật memory thủ công (để lưu cho lần gọi sau)
    // Lưu User Input
    memory[userId].push({ role: "user", parts: [{ text: question }] });
    // Lưu Model Output
    memory[userId].push({ role: "model", parts: [{ text: text }] });

    // Giới hạn lịch sử (giữ lại 10 lượt chat gần nhất = 20 tin nhắn)
    if (memory[userId].length > 20) {
      memory[userId] = memory[userId].slice(-20);
    }

    return message.reply(text);

  } catch (err) {
    console.error("Gemini error:", err);
    
    // Reset memory nếu lỗi do lịch sử bị hỏng
    memory[userId] = []; 
    
    return message.reply("❌ Bot gặp lỗi kết nối hoặc nội dung bị chặn. (Đã reset cuộc hội thoại của bạn).");
  }
}

// ===============================
// LOGIN BOT
// ===============================
client.login(process.env.TOKEN);
