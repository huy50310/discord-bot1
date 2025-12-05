module.exports = {
  name: 'say',
  execute: async (message, args) => {

    // Chỉ admin mới dùng
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ Bạn không phải admin.');
    }

    const text = args.join(' ');
    if (!text) return;

    // XÓA tin nhắn người dùng (ẩn người dùng lệnh)
    await message.delete();

    // Bot nói thay
    message.channel.send(text);
  }
};