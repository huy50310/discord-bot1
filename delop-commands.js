require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Hỏi bất kỳ điều gì bot sẽ trả lời bằng Gemini")
    .addStringOption(option =>
      option.setName("question")
        .setDescription("Câu hỏi của bạn")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Bot nói thay bạn (Admin)")
    .addStringOption(option =>
      option.setName("text")
        .setDescription("Nội dung")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Gửi thông báo (Admin)")
    .addStringOption(option =>
      option.setName("text")
        .setDescription("Nội dung thông báo")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Kênh để gửi thông báo")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

async function deploy() {
  try {
    console.log("🚀 Đang deploy slash commands...");

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Deploy slash commands thành công!");
  } catch (err) {
    console.error(err);
  }
}

deploy();
