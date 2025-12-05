require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [

  // ===== /ping =====
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Kiểm tra bot hoạt động"),

  // ===== /say =====
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Bot nói thay bạn")
    .addStringOption(option =>
      option
        .setName("text")
        .setDescription("Nội dung muốn bot nói")
        .setRequired(true)
    ),

  // ===== /announce =====
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Gửi thông báo vào channel")
    .addStringOption(option =>
      option
        .setName("text")
        .setDescription("Nội dung thông báo")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel muốn thông báo vào")
        .setRequired(true)
    ),

  // ===== /ask =====
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Hỏi Gemini và nhận câu trả lời")
    .addStringOption(option =>
      option
        .setName("question")
        .setDescription("Câu hỏi của bạn")
        .setRequired(true)
    ),
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("🚀 Deploying slash commands...");

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Deploy slash commands thành công!");
  } catch (error) {
    console.error("❌ Lỗi deploy:", error);
  }
})();
