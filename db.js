const Database = require('better-sqlite3');
const path = require('path');

// Файл базы данных. На Railway подключите Volume и укажите путь туда через DB_PATH,
// иначе при каждом деплое база будет обнуляться.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'free',        -- free | taken | sent | interested
    executor TEXT,
    taken_at TEXT,
    processed_at TEXT,
    comment TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_numbers_status ON numbers(status);
  CREATE INDEX IF NOT EXISTS idx_numbers_executor ON numbers(executor);
`);

const BATCH_SIZE = 45;

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d]/g, '');
}

function getBatch(user) {
  return db.prepare(
    `SELECT * FROM numbers WHERE executor = ? AND status IN ('taken','sent','interested') ORDER BY id`
  ).all(user);
}

function takeBatch(user) {
  const existing = getBatch(user);
  if (existing.length > 0) {
    return { success: false, message: `У вас уже есть активная пачка из ${existing.length} номеров.` };
  }
  const free = db.prepare(`SELECT id FROM numbers WHERE status = 'free' LIMIT ?`).all(BATCH_SIZE);
  if (free.length === 0) {
    return { success: false, message: 'Свободных номеров больше нет.' };
  }
  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE numbers SET status = 'taken', executor = ?, taken_at = ? WHERE id = ?`);
  const tx = db.transaction((rows) => {
    for (const row of rows) update.run(user, now, row.id);
  });
  tx(free);
  return { success: true, message: `Взято ${free.length} номеров.`, count: free.length };
}

function markSent(id) {
  db.prepare(`UPDATE numbers SET status = 'sent', processed_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
  return true;
}

function markInterested(id, comment) {
  db.prepare(`UPDATE numbers SET status = 'interested', processed_at = ?, comment = ? WHERE id = ?`)
    .run(new Date().toISOString(), comment || '', id);
  return true;
}

function getAdminStats() {
  const total = db.prepare(`SELECT COUNT(*) c FROM numbers`).get().c;
  const sent = db.prepare(`SELECT COUNT(*) c FROM numbers WHERE status = 'sent'`).get().c;
  const interested = db.prepare(`SELECT COUNT(*) c FROM numbers WHERE status = 'interested'`).get().c;
  const free = db.prepare(`SELECT COUNT(*) c FROM numbers WHERE status = 'free'`).get().c;

  const rows = db.prepare(`
    SELECT executor,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
           SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) as interested
    FROM numbers
    WHERE executor IS NOT NULL
    GROUP BY executor
  `).all();

  const stats = {};
  rows.forEach(r => {
    stats[r.executor] = { total: r.total, sent: r.sent, interested: r.interested };
  });

  return { total, sent, interested, free, stats };
}

function getInterests() {
  return db.prepare(`SELECT * FROM numbers WHERE status = 'interested' ORDER BY processed_at DESC`).all();
}

function importNumbers(rawNumbers) {
  const existing = new Set(
    db.prepare(`SELECT phone FROM numbers`).all().map(r => r.phone)
  );
  const insert = db.prepare(`INSERT INTO numbers (phone, status) VALUES (?, 'free')`);

  let added = 0, duplicates = 0, invalid = 0;
  const tx = db.transaction((numbers) => {
    for (const raw of numbers) {
      const phone = normalizePhone(raw);
      if (!phone || phone.length < 7) { invalid++; continue; }
      if (existing.has(phone)) { duplicates++; continue; }
      existing.add(phone);
      insert.run(phone);
      added++;
    }
  });
  tx(rawNumbers);

  return { added, duplicates, invalid, total: rawNumbers.length };
}

module.exports = {
  getBatch, takeBatch, markSent, markInterested,
  getAdminStats, getInterests, importNumbers, normalizePhone
};
