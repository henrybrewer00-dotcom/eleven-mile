import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = join(__dirname, 'data', 'audio');
mkdirSync(AUDIO_DIR, { recursive: true });

const db = new Database(join(__dirname, 'data', 'battles.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    figure1 TEXT NOT NULL,
    figure2 TEXT NOT NULL,
    title TEXT,
    battle_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER NOT NULL,
    section_index INTEGER NOT NULL,
    name TEXT NOT NULL,
    rapper TEXT NOT NULL,
    lines_json TEXT NOT NULL,
    audio_path TEXT,
    FOREIGN KEY (battle_id) REFERENCES battles(id)
  );
`);

const stmts = {
  insertBattle: db.prepare(`INSERT INTO battles (figure1, figure2, title, battle_json) VALUES (?, ?, ?, ?)`),
  insertSection: db.prepare(`INSERT INTO sections (battle_id, section_index, name, rapper, lines_json) VALUES (?, ?, ?, ?, ?)`),
  updateSectionAudio: db.prepare(`UPDATE sections SET audio_path = ? WHERE id = ?`),
  listBattles: db.prepare(`SELECT id, figure1, figure2, title, created_at FROM battles ORDER BY created_at DESC`),
  getBattle: db.prepare(`SELECT * FROM battles WHERE id = ?`),
  getSections: db.prepare(`SELECT * FROM sections WHERE battle_id = ? ORDER BY section_index`),
  deleteBattle: db.prepare(`DELETE FROM battles WHERE id = ?`),
  deleteSections: db.prepare(`DELETE FROM sections WHERE battle_id = ?`),
};

export function saveBattle(figure1, figure2, battleData) {
  const result = stmts.insertBattle.run(figure1, figure2, battleData.title, JSON.stringify(battleData));
  const battleId = result.lastInsertRowid;

  const sectionIds = [];
  for (let i = 0; i < battleData.sections.length; i++) {
    const section = battleData.sections[i];
    const r = stmts.insertSection.run(battleId, i, section.name, section.rapper, JSON.stringify(section.lines));
    sectionIds.push(Number(r.lastInsertRowid));
  }

  return { battleId: Number(battleId), sectionIds };
}

export function saveSectionAudio(sectionId, audioBuffer) {
  const filename = `section_${sectionId}.mp3`;
  const filepath = join(AUDIO_DIR, filename);
  writeFileSync(filepath, Buffer.from(audioBuffer));
  stmts.updateSectionAudio.run(filename, sectionId);
  return filename;
}

export function listBattles() {
  return stmts.listBattles.all();
}

export function loadBattle(id) {
  const battle = stmts.getBattle.get(id);
  if (!battle) return null;
  const sections = stmts.getSections.all(id);
  return {
    ...battle,
    battle_json: JSON.parse(battle.battle_json),
    sections: sections.map(s => ({
      ...s,
      lines_json: JSON.parse(s.lines_json),
    })),
  };
}

export function deleteBattle(id) {
  stmts.deleteSections.run(id);
  stmts.deleteBattle.run(id);
}

export function getSectionAudioPath(filename) {
  const p = join(AUDIO_DIR, filename);
  return existsSync(p) ? p : null;
}

export { AUDIO_DIR };
