import { AppUser, Meal, MealLog, Participant, ScanResult } from '../types';
import { socket } from './socket';

// Only per-browser preferences live in localStorage now. Everything else
// (participants, meals, logs, users, the simulated clock) is shared state
// that lives on the server and is mirrored here in memory.
const LOCAL_KEYS = {
  CURRENT_USER: 'emt_current_user_v1'
};

interface SharedState {
  participants: Participant[];
  meals: Meal[];
  logs: MealLog[];
  users: AppUser[];
  timeOverride: string | null;
}

const cache: SharedState = {
  participants: [],
  meals: [],
  logs: [],
  users: [],
  timeOverride: null
};

let bootstrapped = false;
let listenersAttached = false;

async function apiGet(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

function applySharedState(state: Partial<SharedState>) {
  Object.assign(cache, state);
  StorageService.notifySubscribers();
}

async function fetchAndApplyState() {
  try {
    const state = await apiGet('/api/state');
    applySharedState(state);
  } catch (err) {
    console.error('Failed to load shared event data from server:', err);
  }
}

export class StorageService {
  // --- Initialization ---
  public static init(): void {
    if (typeof window === 'undefined') return;

    // Load the shared state from the server right away.
    fetchAndApplyState();

    if (!listenersAttached) {
      listenersAttached = true;

      // Any client's change (an import, a scan, a schedule edit...) is
      // broadcast here so every open dashboard/scanner/registry updates.
      socket.on('data-updated', ({ state }: { reason: string; state: SharedState }) => {
        applySharedState(state);
      });

      // Re-sync in case events were missed while disconnected.
      socket.on('connect', () => {
        fetchAndApplyState();
      });
    }

    bootstrapped = true;
  }

  public static isBootstrapped(): boolean {
    return bootstrapped;
  }

  // --- Reset to Defaults ---
  public static resetToDefault(): void {
    apiPost('/api/reset')
      .then((res) => applySharedState(res.state))
      .catch((err) => console.error('Reset failed:', err));
  }

  // --- Subscribers / Cross-tab Event ---
  private static subscribers: (() => void)[] = [];

  public static subscribe(callback: () => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
    };
  }

  public static notifySubscribers(): void {
    this.subscribers.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('Subscriber notification error', err);
      }
    });
  }

  // --- Time & Meal Logic (shared clock, kept in sync via broadcasts) ---
  public static getTimeOverride(): string | null {
    return cache.timeOverride;
  }

  public static setTimeOverride(time: string | null): void {
    cache.timeOverride = time; // optimistic, instant feedback for this client
    this.notifySubscribers();
    apiPost('/api/time-override', { time }).catch((err) => {
      console.error('Failed to update simulated clock:', err);
    });
  }

  public static getCurrentClockTime(): string {
    const override = this.getTimeOverride();
    if (override) return override;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Evaluates if a given time "HH:mm" is within [startTime, endTime)
   * Handles windows crossing midnight (e.g., 22:00 to 02:00)
   */
  public static isTimeInWindow(curr: string, start: string, end: string): boolean {
    if (start <= end) {
      return curr >= start && curr < end;
    } else {
      // Crosses midnight: e.g. start=22:00, end=02:00
      return curr >= start || curr < end;
    }
  }

  public static getMeals(): Meal[] {
    return cache.meals;
  }

  public static updateMeals(meals: Meal[]): void {
    cache.meals = meals; // optimistic
    this.notifySubscribers();
    apiPost('/api/meals', { meals }).catch((err) => {
      console.error('Failed to update meal schedule:', err);
    });
  }

  public static getActiveMeal(): Meal | null {
    const curr = this.getCurrentClockTime();
    const meals = this.getMeals();
    for (const meal of meals) {
      if (this.isTimeInWindow(curr, meal.startTime, meal.endTime)) {
        return meal;
      }
    }
    return null;
  }

  public static getNextMeal(): Meal | null {
    const curr = this.getCurrentClockTime();
    const meals = this.getMeals();
    // Sort meals by start time
    const sorted = [...meals].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const next = sorted.find((m) => m.startTime > curr);
    if (next) return next;
    // Otherwise loops back to first meal of next day
    return sorted[0] || null;
  }

  // --- Participants ---
  public static getParticipants(): Participant[] {
    return cache.participants;
  }

  public static addParticipant(p: Participant): boolean {
    const participants = this.getParticipants();
    if (participants.some((item) => item.uid === p.uid)) {
      return false; // duplicate UID
    }
    cache.participants = [...participants, p]; // optimistic
    this.notifySubscribers();
    apiPost('/api/participants', p).catch((err) => {
      console.error('Failed to save new participant:', err);
    });
    return true;
  }

  public static getParticipantByUid(uid: number): Participant | undefined {
    const participants = this.getParticipants();
    return participants.find((p) => p.uid === uid);
  }

  /**
   * Bulk-add participants (used by Excel import). Skips any UID that
   * already exists. Returns the count actually added.
   */
  public static bulkAddParticipants(newParticipants: Participant[]): number {
    if (newParticipants.length === 0) return 0;

    const participants = [...this.getParticipants()];
    const existingUids = new Set(participants.map((p) => p.uid));
    let addedCount = 0;
    const toAdd: Participant[] = [];

    newParticipants.forEach((p) => {
      if (!existingUids.has(p.uid)) {
        participants.push(p);
        existingUids.add(p.uid);
        addedCount++;
        toAdd.push(p);
      }
    });

    if (addedCount > 0) {
      cache.participants = participants; // optimistic
      this.notifySubscribers();
      apiPost('/api/participants/bulk', { participants: toAdd }).catch((err) => {
        console.error('Failed to sync imported participants to server:', err);
      });
    }

    return addedCount;
  }

  // --- Users & Authentication ---
  public static getUsers(): AppUser[] {
    return cache.users;
  }

  public static getCurrentUser(): AppUser | null {
    try {
      const data = localStorage.getItem(LOCAL_KEYS.CURRENT_USER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  public static setCurrentUser(user: AppUser | null): void {
    if (user) {
      localStorage.setItem(LOCAL_KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(LOCAL_KEYS.CURRENT_USER);
    }
    this.notifySubscribers();
  }

  public static login(usn: string, password: string): { success: boolean; user?: AppUser; message?: string } {
    const users = this.getUsers();
    const cleanUsn = usn.trim().toUpperCase();
    const found = users.find((u) => u.usn.toUpperCase() === cleanUsn);

    if (!found) {
      return { success: false, message: `USN "${cleanUsn}" not registered.` };
    }

    if (found.passwordHash !== password) {
      return { success: false, message: 'Invalid password. Please try again.' };
    }

    this.setCurrentUser(found);
    return { success: true, user: found };
  }

  public static addVolunteer(
    name: string,
    usn: string,
    password: string,
    role: string = 'Volunteer'
  ): { success: boolean; message?: string } {
    const cleanUsn = usn.trim().toUpperCase();
    const users = this.getUsers();

    if (users.some((u) => u.usn.toUpperCase() === cleanUsn)) {
      return { success: false, message: `A volunteer with USN ${cleanUsn} is already registered.` };
    }

    const newUser: AppUser = {
      id: `user_${Date.now()}`,
      name: name.trim(),
      usn: cleanUsn,
      passwordHash: password,
      role: role.trim() || 'Volunteer',
      createdAt: new Date().toISOString()
    };

    cache.users = [...users, newUser]; // optimistic, so this device sees it immediately
    this.notifySubscribers();

    apiPost('/api/users', { name, usn: cleanUsn, password, role }).catch((err) => {
      console.error('Failed to save new volunteer to server:', err);
    });

    return { success: true };
  }

  // --- Meal Logs & Scanning ---
  public static getLogs(): MealLog[] {
    return cache.logs;
  }

  /**
   * Process a QR scan or manual UID input. Resolved instantly against this
   * device's local copy of the shared state for immediate feedback (sound,
   * confetti, undo button), then confirmed with the server, which is the
   * final authority — if two volunteers scan the same guest at the same
   * instant, the server's broadcast reconciles every dashboard a moment
   * later so nobody ends up double-counted.
   */
  public static processScan(rawInput: string | number, volunteerUsn: string): ScanResult {
    const nowIso = new Date().toISOString();

    // 1. Extract numeric UID (handles pure number, string number, or formatted QR text like "UID:1004" or "https://.../1004")
    let uid: number;
    if (typeof rawInput === 'number') {
      uid = rawInput;
    } else {
      const cleaned = rawInput.trim();
      const match = cleaned.match(/\b\d{3,6}\b/);
      if (match) {
        uid = parseInt(match[0], 10);
      } else {
        const parsed = parseInt(cleaned, 10);
        if (isNaN(parsed)) {
          return {
            status: 'INVALID_PARTICIPANT',
            message: `Unrecognized QR format: "${rawInput}"`,
            timestamp: nowIso
          };
        }
        uid = parsed;
      }
    }

    // Fire the authoritative request to the server in the background; it
    // will broadcast the real outcome to every client (including this one).
    apiPost('/api/scan', { rawInput, volunteerUsn }).catch((err) => {
      console.error('Failed to sync scan to server:', err);
    });

    // 2. Lookup Participant
    const participant = this.getParticipantByUid(uid);
    if (!participant) {
      return {
        status: 'INVALID_PARTICIPANT',
        message: `Participant #${uid} not found in guest registry.`,
        timestamp: nowIso
      };
    }

    // 3. Check Active Meal
    const activeMeal = this.getActiveMeal();
    if (!activeMeal) {
      const nextMeal = this.getNextMeal();
      return {
        status: 'NO_ACTIVE_MEAL',
        message: `No meal active right now (Current time: ${this.getCurrentClockTime()}). Next: ${nextMeal ? nextMeal.name + ' at ' + nextMeal.startTime : 'None scheduled'}`,
        participant,
        timestamp: nowIso
      };
    }

    // 4. Check if already scanned for this active meal
    const logs = this.getLogs();
    const existingLog = logs.find(
      (log) => log.participantUid === uid && log.mealId === activeMeal.id
    );

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

    // 5. Successful first scan - log entry (optimistic; server broadcast is authoritative)
    const newLog: MealLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      participantUid: participant.uid,
      participantName: participant.name,
      team: participant.team,
      mealId: activeMeal.id,
      mealName: activeMeal.name,
      scannedAt: nowIso,
      scannedByUsn: volunteerUsn || 'VOLUNTEER'
    };

    cache.logs = [newLog, ...logs];
    this.notifySubscribers();

    return {
      status: 'SUCCESS',
      message: `${participant.name} marked for ${activeMeal.name}`,
      participant,
      meal: activeMeal,
      timestamp: nowIso,
      logId: newLog.id
    };
  }

  /**
   * Undo an accidental scan
   */
  public static undoScan(logId: string): boolean {
    const logs = this.getLogs();
    const index = logs.findIndex((l) => l.id === logId);
    if (index === -1) return false;

    cache.logs = logs.filter((l) => l.id !== logId); // optimistic
    this.notifySubscribers();

    apiPost('/api/scan/undo', { logId }).catch((err) => {
      console.error('Failed to sync undo to server:', err);
    });

    return true;
  }

  /**
   * Live Dashboard: Get Pending Participants for a specific meal, grouped by Team
   */
  public static getPendingGroupedByTeam(mealId: string): {
    team: string;
    totalInTeam: number;
    servedCount: number;
    pendingCount: number;
    pendingParticipants: Participant[];
  }[] {
    const participants = this.getParticipants();
    const logs = this.getLogs();

    // Set of UIDs served for this meal
    const servedUids = new Set(
      logs.filter((l) => l.mealId === mealId).map((l) => l.participantUid)
    );

    // Group all participants by team
    const teamMap = new Map<string, Participant[]>();
    for (const p of participants) {
      if (!teamMap.has(p.team)) {
        teamMap.set(p.team, []);
      }
      teamMap.get(p.team)!.push(p);
    }

    const result: {
      team: string;
      totalInTeam: number;
      servedCount: number;
      pendingCount: number;
      pendingParticipants: Participant[];
    }[] = [];

    teamMap.forEach((members, team) => {
      const pending = members.filter((p) => !servedUids.has(p.uid));
      result.push({
        team,
        totalInTeam: members.length,
        servedCount: members.length - pending.length,
        pendingCount: pending.length,
        pendingParticipants: pending
      });
    });

    // Sort teams alphabetically
    return result.sort((a, b) => a.team.localeCompare(b.team));
  }
}
