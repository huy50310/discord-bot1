require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Kiểm tra bot hoạt động"),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Bot nói thay bạn")
    .addStringOption(option => 
      option.setName("text")
        .setDescription("Nội dung muốn bot nói")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Gửi thông báo vào channel")
    .addStringOption(option =>
      option.setName("text")
        .setDescription("Nội dung thông báo")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Kênh cần gửi thông báo")
        .setRequired(true)
    )

].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("🔄 Đang cập nhật slash commands...");

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Slash Commands đã đăng ký thành công!");
  } catch (err) {
    console.error(err);
  }
})();
