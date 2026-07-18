require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL; // например https://your-app.up.railway.app
const ADMIN_USERS = (process.env.ADMIN_TELEGRAM_USERNAMES || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN не задан в переменных окружения. Бот не запущен.');
  return;
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = (msg.from.username || '').toLowerCase();
  const isAdmin = ADMIN_USERS.includes(username);

  const url = isAdmin ? `${APP_URL}/admin.html` : `${APP_URL}/executor.html`;
  const label = isAdmin ? '📊 Открыть дашборд' : '📋 Открыть мои задания';

  bot.sendMessage(chatId, `Привет, ${msg.from.first_name}! Нажмите кнопку ниже, чтобы открыть приложение.`, {
    reply_markup: {
      inline_keyboard: [[{ text: label, web_app: { url } }]]
    }
  });
});

console.log('Telegram-бот запущен (long polling).');

module.exports = bot;
