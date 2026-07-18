require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_USERS = (process.env.ADMIN_TELEGRAM_USERNAMES || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// ---------- Проверка подлинности данных Telegram Mini App ----------
// Telegram.WebApp.initData приходит с подписью (hash). Проверяем её,
// чтобы никто не мог подделать имя пользователя и выдать себя за другого.
function verifyInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  const user = JSON.parse(userJson);
  return { id: user.id, username: user.username || `id${user.id}`, firstName: user.first_name };
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const user = verifyInitData(initData);
  if (!user) {
    return res.status(401).json({ error: 'Не удалось подтвердить пользователя Telegram.' });
  }
  req.tgUser = user;
  next();
}

function adminOnly(req, res, next) {
  const uname = (req.tgUser.username || '').toLowerCase();
  if (!ADMIN_USERS.includes(uname)) {
    return res.status(403).json({ error: 'Доступ только для администратора.' });
  }
  next();
}

// ---------- Исполнитель ----------
app.get('/api/batch', authMiddleware, (req, res) => {
  res.json(db.getBatch(req.tgUser.username));
});

app.post('/api/take-batch', authMiddleware, (req, res) => {
  res.json(db.takeBatch(req.tgUser.username));
});

app.post('/api/mark-sent', authMiddleware, (req, res) => {
  const { id } = req.body;
  db.markSent(id);
  res.json({ success: true });
});

app.post('/api/mark-interested', authMiddleware, (req, res) => {
  const { id, comment } = req.body;
  db.markInterested(id, comment);
  res.json({ success: true });
});

// ---------- Администратор ----------
app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  res.json(db.getAdminStats());
});

app.get('/api/admin/interests', authMiddleware, adminOnly, (req, res) => {
  res.json(db.getInterests());
});

app.post('/api/admin/import', authMiddleware, adminOnly, (req, res) => {
  const { numbers } = req.body;
  if (!Array.isArray(numbers)) {
    return res.status(400).json({ error: 'Ожидается массив numbers.' });
  }
  res.json(db.importNumbers(numbers));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

// Запускаем бота в том же процессе (long polling)
require('./bot');
