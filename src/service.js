import { Engine as E } from './engine.js';
import { fraction, goalScore } from './game.js';
import { officialLevels } from './levels.js';
import { rankRecords, leaderboardForViewer } from './ranking.js';

export const levelKey = level => `${level.id}@${level.version || 1}`;
export { compareRecords } from './ranking.js';
const empty = () => ({ schema: 1, profiles: [], activeProfileId: null, levels: [], records: {}, progress: {}, attempts: {}, completions: {}, draft: null, preferences: { decimal: false, tutorialSeen: false, numberFormatHintSeen: false, explorationHintSeen: false } });

// Store the first successful prefix independently of subsequent experiments.
export function completionFromMoves(level, moves, { assisted = false } = {}) {
  try {
    const goal = goalScore(level);
    if (!goal) return null;
    const index = E.replay(level, moves).findIndex(state => E.cmp(state.w[level.t], goal) >= 0);
    return index < 0 ? null : { moves: moves.slice(0, index), assisted: assisted === true };
  } catch { return null; }
}
export function preferredCompletion(current, candidate) {
  return candidate && (!current || (current.assisted && !candidate.assisted)) ? candidate : current;
}
export function validatedGoal(value) {
  return value === undefined || value === null || value === '' ? undefined : E.str(E.parse(value));
}

const canonicalMoves = (raw, validated, moves) => moves.map(k => {
  if (!Number.isInteger(k) || k < 0 || k >= raw.e.length) throw new Error('无效阀门');
  const [a, b] = raw.e[k].slice().sort((x, y) => x - y);
  return validated.e.findIndex(edge => edge[0] === a && edge[1] === b);
});

// All persistence goes through this adapter. A remote adapter can implement the
// same methods; clocks and verification must then move to the server.
export class LocalService {
  constructor({ storage = globalThis.localStorage, now = () => Date.now(), uuid = () => crypto.randomUUID(), onStorageError = () => {} } = {}) {
    this.storage = storage;
    this.now = now;
    this.uuid = uuid;
    this.onStorageError = onStorageError;
    this.storageKey = 'waterline-app-v1';
    this.memory = empty();
    this.listeners = new Set();
    this.persistent = true;
    this.read();
    globalThis.addEventListener?.('storage', event => {
      if (event.key === this.storageKey) { this.read(); this.emit(true); }
    });
  }
  read() {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.schema !== 1 || !Array.isArray(data.profiles) || !Array.isArray(data.levels) || !data.records || !data.progress) throw new Error('Invalid local data');
        this.memory = { ...empty(), ...data, preferences: { ...empty().preferences, ...data.preferences } };
      }
    } catch { this.persistent = false; this.onStorageError(); }
    return this.memory;
  }
  write(data) {
    this.memory = data;
    try { this.storage.setItem(this.storageKey, JSON.stringify(data)); this.persistent = true; }
    catch { this.persistent = false; this.onStorageError(); }
    this.emit();
  }
  emit(external = false) { this.listeners.forEach(listener => listener(external)); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getProfile() { const d = this.read(); return d.profiles.find(p => p.id === d.activeProfileId) || null; }
  getProfiles() { return this.read().profiles.slice(); }
  exportLocal() {
    const data=this.read(), id=this.getProfile()?.id || 'guest', progress={}, attempts={}, completions={};
    for(const [key,moves] of Object.entries(data.progress)) if(key.startsWith(id+':')) progress[key.slice(key.indexOf(':')+1)]=moves.slice();
    for(const [key,attempt] of Object.entries(data.attempts)) if(key.startsWith(id+':')) attempts[key.slice(key.indexOf(':')+1)]=structuredClone(attempt);
    for(const [key,completion] of Object.entries(data.completions)) if(key.startsWith(id+':')) completions[key.slice(key.indexOf(':')+1)]=structuredClone(completion);
    return {schema:'waterline-local-v1',playerName:this.getProfile()?.name || '访客',progress,attempts,completions,draft:data.draft};
  }
  createProfile(name) {
    name = String(name).trim();
    if (!name || name.length > 20) throw new Error('昵称需要 1–20 个字符');
    const d = this.read();
    if (d.profiles.some(p => p.name === name)) throw new Error('这个昵称已存在，请从下方切换玩家');
    const profile = { id: this.uuid(), name, username:name };
    d.profiles.push(profile); d.activeProfileId = profile.id; this.write(d);
    return profile;
  }
  switchProfile(id) {
    const d = this.read();
    if (id !== null && !d.profiles.some(p => p.id === id)) throw new Error('玩家不存在');
    d.activeProfileId = id; this.write(d);
  }
  getOfficialLevels() { return officialLevels; }
  getMyRecord(key) { return this.rankedRecords(key).find(r => r.playerId === this.getProfile()?.id) || null; }
  getRank(key) { return this.getMyRecord(key)?.rank ?? null; }
  getSubmissionCount(key) { return this.rankedRecords(key).length; }
  getCommunityLevels() {
    return this.read().levels.filter(p => { try { E.validate(p); return p.deletedAt == null; } catch { return false; } }).sort((a, b) => b.publishedAt - a.publishedAt);
  }
  getLevel(key) { return [...officialLevels, ...this.getCommunityLevels()].find(p => levelKey(p) === key) || null; }
  rankedRecords(key) {
    const d = this.read(), level = this.getLevel(key);
    if (!level) return [];
    return rankRecords((d.records[key] || []).filter(r => {
      try {
        const score = E.str(E.replay(level, r.moves).at(-1).w[level.t]);
        return score === r.score && Number.isFinite(r.achievedAt) && r.achievedAt >= 0 && r.achievedAt <= 8.64e15 && d.profiles.some(p => p.id === r.playerId);
      } catch { return false; }
    }).map(r => ({ ...r, playerName: d.profiles.find(p => p.id === r.playerId).name, playerUsername: d.profiles.find(p => p.id === r.playerId).username || d.profiles.find(p => p.id === r.playerId).name })));
  }
  async submitRun({ key, moves }) {
    const profile = this.getProfile(), level = this.getLevel(key);
    if (!profile) throw new Error('请先创建或选择本地玩家');
    if (!level) throw new Error('关卡版本不存在');
    const score = E.str(E.replay(level, moves).at(-1).w[level.t]);
    const d = this.read();
    const records = this.rankedRecords(key);
    const existing = records.find(r => r.playerId === profile.id);
    if (existing && E.cmp(fraction(score), fraction(existing.score)) <= 0) {
      this.write(d);
      return { improved: false, record: existing, rank: existing.rank, leaderboard:this.getBoard(key) };
    }
    const record = { id: existing?.id || this.uuid(), playerId: profile.id, score, achievedAt: this.now(), moves: moves.slice() };
    d.records[key] = records.filter(r => r.playerId !== profile.id).map(({ playerName, ...r }) => r);
    d.records[key].push(record); this.write(d);
    return { improved: true, record, rank: this.getRank(key), leaderboard:this.getBoard(key) };
  }
  async publishLevel(raw, moves) {
    const profile = this.getProfile();
    if (!profile) throw new Error('请先创建或选择本地玩家');
    const validated = E.validate(raw);
    moves = canonicalMoves(raw, validated, moves);
    const d=this.read();
    const sequence=Math.max(0,...d.levels.filter(level=>level.authorId===profile.id).map(level=>level.authorSequence || 0))+1;
    const level={...validated,id:'community-'+this.uuid(),version:1,source:'community',name:(profile.username || profile.name)+'-'+sequence,
      pos:sanitizePositions(raw.pos,validated.w.length),description:String(raw.description || '').slice(0,100),
      authorId:profile.id,authorName:profile.username || profile.name,authorUsername:profile.username || profile.name,authorSequence:sequence,publishedAt:this.now()};
    d.levels.push(level);d.draft=null;this.write(d);
    return level;
  }
  async deleteLevel(key) {
    const profile = this.getProfile(), level = this.getLevel(key);
    if (!profile) throw new Error('请先登录');
    if (!level) throw new Error('关卡不存在');
    if (level.source !== 'community' || level.authorId !== profile.id) throw new Error('只能删除自己发布的关卡');
    const data = this.read();
    data.levels.find(item => levelKey(item) === key).deletedAt = this.now();
    this.write(data);
  }
  saveProgress() {}
  getAttempt() { return {moves:[],assisted:false}; }
  getProgress() { return []; }
  getCompletion() { return null; }
  getBoard(key,offset=0) { return leaderboardForViewer(this.rankedRecords(key),this.getProfile()?.id,offset); }
  getLeaderboard(key) { return this.getBoard(key).records; }
  async loadLeaderboard(key,offset=0) { this.boardOffset=offset;this.emit();return this.getBoard(key,offset); }
  getGameLevels() { return [...this.getOfficialLevels(),...this.getCommunityLevels().filter(level=>level.featured)]; }
  async searchPlayers(query) { return this.getProfiles().filter(player=>(player.username || player.name).toLowerCase().includes(query.toLowerCase())).map(player=>({id:player.username || player.name,username:player.username || player.name})); }
  async getPlayerProfile(username) {
    const player=this.getProfiles().find(player=>(player.username || player.name)===username);
    if(!player)throw Error('玩家不存在');
    const levels=this.getCommunityLevels().filter(level=>level.authorId===player.id),records=[];
    for(const [key,rows] of Object.entries(this.read().records)) {
      const ranked=this.rankedRecords(key),row=ranked.find(row=>row.playerId===player.id),viewer=ranked.find(row=>row.playerId===this.getProfile()?.id);
      if(row)records.push({key,name:this.getLevel(key)?.name || key,rank:row.rank,score:viewer && row.rank>=viewer.rank?row.score:null});
    }
    return {player:{id:username,username},levels,records};
  }
  getDraft() { return this.read().draft; }
  saveDraft(draft) { const d = this.read(); d.draft = draft; this.write(d); }
  getPreferences() { return this.read().preferences; }
  setPreferences(next) { const d = this.read(); Object.assign(d.preferences, next); this.write(d); }
}

export function sanitizePositions(positions, count) {
  if (!Array.isArray(positions) || positions.length !== count || positions.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v)))) return undefined;
  return positions.map(([x, y]) => [Math.max(65, Math.min(735, x)), Math.max(75, Math.min(405, y))]);
}

export function readPuzzleFile(text) {
  const file = JSON.parse(text);
  const raw = file.puzzle || file;
  const validated = E.validate(raw);
  const goalWater = validatedGoal(raw.goalWater);
  return { ...validated, ...(goalWater === undefined ? {} : { goalWater }), pos: sanitizePositions(raw.pos, validated.w.length), description: String(raw.description || '').slice(0, 100) };
}
