import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildDefaultDb } from './seedData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(buildDefaultDb(), null, 2));
  }
}

/**
 * Reads the whole database from disk. Cheap, synchronous, and fine for
 * an event-day headcount tool — no need for a real DBMS here. Node's
 * request handling is single-threaded, so read-modify-write within one
 * request handler is effectively atomic.
 */
export function readDB() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return { ...buildDefaultDb(), ...JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to read db.json, falling back to defaults:', err);
    return buildDefaultDb();
  }
}

export function writeDB(db) {
  ensureDbFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/** Returns the full shared state exactly as the frontend's StorageService expects it. */
export function getFullState() {
  const db = readDB();
  return {
    participants: db.participants,
    meals: db.meals,
    logs: db.logs,
    users: db.users,
    timeOverride: db.timeOverride ?? null
  };
}

export function resetToDefault() {
  const fresh = buildDefaultDb();
  writeDB(fresh);
  return getFullState();
}

// --- Participants ---
export function getParticipants() {
  return readDB().participants;
}

export function addParticipant(p) {
  const db = readDB();
  if (db.participants.some((item) => item.uid === p.uid)) {
    return { success: false, message: `UID #${p.uid} is already registered.` };
  }
  db.participants.push(p);
  writeDB(db);
  return { success: true, participants: db.participants };
}

/**
 * Bulk-add participants, skipping any UID that already exists in the DB
 * (or duplicated within the same batch).
 */
export function bulkAddParticipants(newParticipants) {
  const db = readDB();
  const existingUids = new Set(db.participants.map((p) => p.uid));
  const addedParticipants = [];

  for (const p of newParticipants) {
    if (existingUids.has(p.uid)) continue;
    db.participants.push(p);
    existingUids.add(p.uid);
    addedParticipants.push(p);
  }

  writeDB(db);
  return { added: addedParticipants.length, addedParticipants, participants: db.participants };
}

// --- Meals & shared clock ---
export function setMeals(meals) {
  const db = readDB();
  db.meals = meals;
  writeDB(db);
  return db.meals;
}

export function setTimeOverride(time) {
  const db = readDB();
  db.timeOverride = time || null;
  writeDB(db);
  return db.timeOverride;
}

export function getCurrentClockTime(db) {
  const override = db.timeOverride;
  if (override) return override;
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Handles windows crossing midnight (e.g., 22:00 to 02:00) */
export function isTimeInWindow(curr, start, end) {
  if (start <= end) {
    return curr >= start && curr < end;
  }
  return curr >= start || curr < end;
}

export function getActiveMeal(db) {
  const curr = getCurrentClockTime(db);
  for (const meal of db.meals) {
    if (isTimeInWindow(curr, meal.startTime, meal.endTime)) {
      return meal;
    }
  }
  return null;
}

export function getNextMeal(db) {
  const curr = getCurrentClockTime(db);
  const sorted = [...db.meals].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const next = sorted.find((m) => m.startTime > curr);
  if (next) return next;
  return sorted[0] || null;
}

// --- Users & Authentication ---
export function getUsers() {
  return readDB().users;
}

export function addVolunteer(name, usn, password, role = 'Volunteer') {
  const db = readDB();
  const cleanUsn = usn.trim().toUpperCase();

  if (db.users.some((u) => u.usn.toUpperCase() === cleanUsn)) {
    return { success: false, message: `A volunteer with USN ${cleanUsn} is already registered.` };
  }

  const newUser = {
    id: `user_${Date.now()}`,
    name: name.trim(),
    usn: cleanUsn,
    passwordHash: password,
    role: role.trim() || 'Volunteer',
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  writeDB(db);
  return { success: true, user: newUser, users: db.users };
}

// --- Meal Logs & Scanning (server is authoritative so two volunteers
// scanning at the same instant can't both log the same meal) ---
export function getLogs() {
  return readDB().logs;
}

export function processScan(rawInput, volunteerUsn) {
  const db = readDB();
  const nowIso = new Date().toISOString();

  // 1. Extract numeric UID (handles pure number, string number, or formatted
  // QR text like "UID:1004" or "https://.../1004")
  let uid;
  if (typeof rawInput === 'number') {
    uid = rawInput;
  } else {
    const cleaned = String(rawInput).trim();
    const match = cleaned.match(/\b\d{3,6}\b/);
    if (match) {
      uid = parseInt(match[0], 10);
    } else {
      const parsed = parseInt(cleaned, 10);
      if (isNaN(parsed)) {
        return { status: 'INVALID_PARTICIPANT', message: `Unrecognized QR format: "${rawInput}"`, timestamp: nowIso };
      }
      uid = parsed;
    }
  }

  // 2. Lookup Participant
  const participant = db.participants.find((p) => p.uid === uid);
  if (!participant) {
    return { status: 'INVALID_PARTICIPANT', message: `Participant #${uid} not found in guest registry.`, timestamp: nowIso };
  }

  // 3. Check Active Meal
  const activeMeal = getActiveMeal(db);
  if (!activeMeal) {
    const nextMeal = getNextMeal(db);
    return {
      status: 'NO_ACTIVE_MEAL',
      message: `No meal active right now (Current time: ${getCurrentClockTime(db)}). Next: ${nextMeal ? nextMeal.name + ' at ' + nextMeal.startTime : 'None scheduled'}`,
      participant,
      timestamp: nowIso
    };
  }

  // 4. Check if already scanned for this active meal
  const existingLog = db.logs.find((log) => log.participantUid === uid && log.mealId === activeMeal.id);
  if (existingLog) {
    return {
      status: 'ALREADY_SCANNED',
      message: `${participant.name} already fed for ${activeMeal.name}`,
      participant,
      meal: activeMeal,
      existingLog,
      timestamp: nowIso
    };
  }

  // 5. Successful first scan - log entry
  const newLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    participantUid: participant.uid,
    participantName: participant.name,
    team: participant.team,
    mealId: activeMeal.id,
    mealName: activeMeal.name,
    scannedAt: nowIso,
    scannedByUsn: volunteerUsn || 'VOLUNTEER'
  };

  db.logs.unshift(newLog);
  writeDB(db);

  return {
    status: 'SUCCESS',
    message: `${participant.name} marked for ${activeMeal.name}`,
    participant,
    meal: activeMeal,
    timestamp: nowIso,
    logId: newLog.id
  };
}

export function undoScan(logId) {
  const db = readDB();
  const index = db.logs.findIndex((l) => l.id === logId);
  if (index === -1) return false;
  db.logs.splice(index, 1);
  writeDB(db);
  return true;
}
