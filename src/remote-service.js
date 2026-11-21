import { LocalService, levelKey } from './service.js';
import { officialLevels } from './levels.js';

const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defaults = { decimal: false, tutorialSeen: false, numberFormatHintSeen: false, explorationHintSeen: false };

export class RemoteService {
  constructor({ fetch = globalThis.fetch.bind(globalThis), storage = globalThis.localStorage, onError = () => {}, events = true } = {}) {
    this.fetch = fetch; this.storage = storage; this.onError = onError; this.online = true;
    this.listeners = new Set(); this.boards = new Map(); this.generation = 0; this.eventsEnabled = events;
    this.data = { player: null, levels: [], progress: {}, completions: {}, records: {}, draft: { puzzle: null, revision: 0 }, preferences: {} };
    this.journalKey = 'waterline-pending-v1'; this.guestKey = 'waterline-guest-v1';
    this.pending = this.read(this.journalKey, {});
    this.legacyPending = this.read('waterline-archived-attempts-v1', {});
    for (const [account,items] of Object.entries(this.pending)) for (const [key,item] of Object.entries(items)) if (key !== 'draft' && key !== 'preferences') {
      (this.legacyPending[account] ||= {})[key] = item; delete items[key];
    }
    this.guest = this.read(this.guestKey, { progress: {}, draft: null, preferences: {} });
    this.guest = { progress: {}, attempts: {}, completions: {}, draft: null, preferences: {}, ...this.guest };
    this.status = '';
    if (events && globalThis.BroadcastChannel) {
      this.channel = new BroadcastChannel('waterline-account');
      this.channel.onmessage = () => { this.generation++; this.refresh(true).catch(error => this.report(error)); };
    }
    globalThis.addEventListener?.('pagehide', () => { this.persist(); void this.flush().catch(() => {}); });
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.flush().catch(() => {});
      else if (events) this.refreshAfterFocus().catch(error => this.report(error));
    });
  }
  read(key, fallback) { try { return JSON.parse(this.storage.getItem(key)) || fallback; } catch { return fallback; } }
  persist() {
    try { this.storage.setItem('waterline-archived-attempts-v1',JSON.stringify(this.legacyPending)); this.storage.setItem(this.journalKey, JSON.stringify(this.pending)); this.storage.setItem(this.guestKey, JSON.stringify(this.guest)); }
    catch { this.onError('浏览器未能保留未同步的数据，请尽快提交或导出备份。'); }
  }
  async api(path, { method = 'GET', body, account = this.getProfile()?.id } = {}) {
    let response;
    try {
      response = await this.fetch('/api' + path, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(35000),
        headers: { 'X-Waterline-Request': '1', ...(account ? { 'X-Waterline-Player': account } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new Error('连接失败，修改已留在本机，请重试同步。'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || '服务暂时不可用'); error.status = response.status; error.code=data.code;
      if (response.status === 401 && this.getProfile()?.id === account && !path.startsWith('/auth/')) {
        this.generation++;
        this.data={...this.data,player:null,progress:{},completions:{},records:{},preferences:{},draft:{puzzle:null,revision:0}};
        this.boards.clear();this.emit(true);
        if(this.watchedKey) void this.loadLeaderboard(this.watchedKey).catch(()=>{});
      }
      if(data.code === 'account_changed') {this.generation++;await this.refresh(true).catch(()=>{});}
      throw error;
    }
    return data;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(external = false) { this.listeners.forEach(fn => fn(external)); }
  report(error) { this.status = error.message; this.onError(error.message); this.emit(); }
  getProfile() { return this.data.player; }
  getPreferences() { return { ...defaults, ...(this.getProfile() ? this.data.preferences : this.guest.preferences) }; }
  getOfficialLevels() { return officialLevels.map(level => this.data.levels.find(p => levelKey(p) === levelKey(level)) || level); }
  getCommunityLevels() { return this.data.levels.filter(p => p.source === 'community').sort((a, b) => b.publishedAt - a.publishedAt); }
  getLevel(key) { return this.data.levels.find(level => levelKey(level) === key) || null; }
  getLeaderboard(key) { return this.boards.get(key)?.records || []; }
  getRank(key) { return this.boards.get(key)?.rank ?? this.boards.get(key)?.mine?.rank ?? this.data.records[key]?.rank ?? null; }
  getMyRecord(key) { return this.boards.get(key)?.mine || this.data.records[key] || null; }
  getSubmissionCount(key) { return this.boards.get(key)?.total ?? this.getLevel(key)?.submissionCount ?? 0; }
  getAttempt() { return {moves:[],assisted:false}; }
  getProgress() { return []; }
  getCompletion() { return null; }
  getDraft() { return clone(this.getProfile() ? this.data.draft.puzzle : this.guest.draft); }
  items() { const id = this.getProfile()?.id; return id ? (this.pending[id] ||= {}) : {}; }
  async refresh(external = false) {
    const generation = this.generation;
    const data = await this.api('/bootstrap');
    if (generation !== this.generation) return;
    const changed = data.player?.id !== this.data.player?.id;
    this.data = { ...data, completions: data.completions || {} };
    if (changed) { this.generation++; this.boards.clear(); }
    for (const [key,item] of Object.entries(this.items())) {
      if (key === 'draft') this.data.draft.puzzle=clone(item.body.puzzle);
      if (key === 'preferences') Object.assign(this.data.preferences,item.body);
    }
    this.emit(external || changed);
    if (changed && this.watchedKey) await this.loadLeaderboard(this.watchedKey);
    this.schedule();
  }
  async refreshAfterFocus() {
    await this.flush(); await this.refresh(true);
    if (this.watchedKey) await this.loadLeaderboard(this.watchedKey);
  }
  async prepareRoute(route) {
    await this.flush(); await this.refresh(true);
    const key = route.startsWith('play/') ? route.slice(5) : '';
    if (key && this.getLevel(key)) await this.loadLeaderboard(key);
    this.watch(this.getLevel(key) ? key : '');
  }
  async loadLeaderboard(key, offset = 0) {
    const generation = this.generation;
    const board = await this.api('/levels/' + encodeURIComponent(key) + '/leaderboard?offset=' + offset);
    if (generation !== this.generation) return;
    this.boards.set(key, board); this.emit(true);
  }
  watch(key = '') {
    if (!this.eventsEnabled || (this.stream && this.watchedKey === key)) return;
    this.stream?.close(); this.watchedKey = key;
    this.stream = new EventSource('/api/events' + (key ? '?key=' + encodeURIComponent(key) : ''));
    this.stream.onmessage = event => {
      const message = JSON.parse(event.data);
      if(message.kind === 'resync' && this.watchedKey) this.loadLeaderboard(this.watchedKey).catch(error=>this.report(error));
      if (message.kind === 'score' && message.key === this.watchedKey) this.loadLeaderboard(message.key).catch(error => this.report(error));
      if (['catalog','resync'].includes(message.kind)) this.api('/levels').then(({levels}) => { this.data.levels = levels; this.emit(true); }).catch(error => this.report(error));
    };
    this.stream.onopen = () => {
      this.api('/levels').then(({levels}) => { this.data.levels = levels; this.emit(true); }).catch(error => this.report(error));
      if (key) this.loadLeaderboard(key).catch(error => this.report(error));
    };
  }
  enqueue(key, path, body, method = 'PUT') {
    const items = this.items(), old = items[key];
    // The revision belongs to the first unsaved edit, including edits made while a request is in flight.
    items[key] = { path, method, body: clone({ ...body, ...(old?.body.revision === undefined ? {} : {revision:old.body.revision}) }), blocked: old?.blocked || false };
    this.status = '正在同步…'; this.persist(); this.schedule(); this.emit();
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.getProfile() && Object.keys(this.items()).length) this.timer = setTimeout(() => { void this.flush().catch(error => this.report(error)); }, 900);
  }
  saveProgress() { /* Attempts are deliberately not persisted. */ }
  saveDraft(puzzle) {
    if (equal(this.getDraft(), puzzle)) return;
    if (!this.getProfile()) { this.guest.draft = clone(puzzle); this.persist(); return; }
    this.data.draft.puzzle = clone(puzzle);
    this.enqueue('draft', '/me/draft', {puzzle,revision:this.data.draft.revision});
  }
  setPreferences(next) {
    if (!this.getProfile()) {Object.assign(this.guest.preferences,next);this.persist();return;}
    Object.assign(this.data.preferences,next);
    this.enqueue('preferences','/me/preferences',{...this.items().preferences?.body,...next},'PATCH');
  }
  async flush() {
    if (this.flushing) { await this.flushing; if (Object.keys(this.items()).length) return this.flush(); return; }
    clearTimeout(this.timer);
    const id = this.getProfile()?.id, generation = this.generation;
    if (!id) return;
    this.flushing = (async () => {
      const items = this.pending[id] || {};
      for (const [key, item] of Object.entries(items)) {
        if (generation !== this.generation) return;
        if (item.blocked) throw new Error('云端已有更新，请先导出本机解法，再在账号设置中使用云端进度。');
        let saved;
        try { saved = await this.api(item.path, {method:item.method,body:item.body,account:id}); }
        catch(error) {if(error.status === 409 && error.code !== 'account_changed') item.blocked = true; this.persist();throw error;}
        if (generation !== this.generation) return;
        if (key === 'draft') this.data.draft.revision = saved.revision;
        if (items[key] === item) delete items[key];
        else if (saved.revision !== undefined) items[key].body.revision = saved.revision;
        this.persist();
      }
      this.status = Object.keys(items).length ? '正在同步…' : ''; this.emit();
    })();
    try { await this.flushing; }
    catch(error) { this.status=error.message;this.emit();throw error; }
    finally { this.flushing = null; }
    if (Object.keys(this.items()).length) return this.flush();
  }
  async authenticate(mode, username, password) {
    await this.flush();
    await this.api('/auth/' + mode, {method:'POST',body:{username,password}});
    this.generation++; await this.refresh(true); this.channel?.postMessage('changed');
  }
  async logout() {
    await this.flush(); await this.api('/auth/logout',{method:'POST'});
    this.generation++; await this.refresh(true); this.channel?.postMessage('changed');
  }
  async useCloud() { await this.flushing?.catch(()=>{}); const id=this.getProfile()?.id; if(id) delete this.pending[id]; this.persist(); this.status=''; await this.refresh(true); }
  pendingBackup() { return { account:this.getProfile()?.username, pending:clone(this.items()),archivedAttempts:clone(this.legacyPending[this.getProfile()?.id] || {}) }; }
  async importLocal(profileId) {
    await this.flush();
    const old = this.read('waterline-app-v1',{}), progress = {}, attempts = {}, completions = {};
    for(const [key,moves] of Object.entries(old.progress || {})) if(key.startsWith((profileId || 'guest') + ':')) progress[key.slice(key.indexOf(':')+1)] = moves;
    for(const [key,attempt] of Object.entries(old.attempts || {})) if(key.startsWith((profileId || 'guest') + ':')) attempts[key.slice(key.indexOf(':')+1)] = attempt;
    for(const [key,completion] of Object.entries(old.completions || {})) if(key.startsWith((profileId || 'guest') + ':')) completions[key.slice(key.indexOf(':')+1)] = completion;
    const result=await this.api('/me/import-local',{method:'POST',body:{progress,attempts,completions,draft:old.draft}});
    await this.refresh(true);return result;
  }
  getLegacyProfiles() { return this.read('waterline-app-v1',{}).profiles || []; }
  async importBackup(data) {
    if(data?.schema !== 'waterline-local-v1' || !data.progress) throw new Error('请选择导出的本机玩家记录文件。');
    await this.flush();const result=await this.api('/me/import-local',{method:'POST',body:{progress:data.progress,attempts:data.attempts || {},completions:data.completions || {},draft:data.draft}});
    await this.refresh(true);return result;
  }
  async submitRun(run) {
    const account = this.getProfile()?.id, generation = this.generation;
    await this.flush();
    if (generation !== this.generation || account !== this.getProfile()?.id) throw new Error('账号已切换，请在当前账号重新提交。');
    const result=await this.api('/runs',{method:'POST',body:run,account});
    if (generation !== this.generation || account !== this.getProfile()?.id) throw new Error('账号已切换，请回到原账号查看这次提交。');
    this.boards.set(run.key,result.leaderboard);this.data.records[run.key]={...result.record,rank:result.rank};this.emit();return result;
  }
  async publishLevel(puzzle,moves) {
    const account = this.getProfile()?.id, generation = this.generation;
    await this.flush();
    if (generation !== this.generation || account !== this.getProfile()?.id) throw new Error('账号已切换，请在当前账号重新发布。');
    const result=await this.api('/levels',{method:'POST',body:{puzzle,moves,draftRevision:this.data.draft.revision},account});
    if (generation !== this.generation || account !== this.getProfile()?.id) throw new Error('账号已切换，请回到原账号查看已发布的关卡。');
    await this.refresh(true);
    if (generation !== this.generation || account !== this.getProfile()?.id) throw new Error('账号已切换，请回到原账号查看已发布的关卡。');
    return this.getLevel(levelKey(result.level)) || result.level;
  }
  async searchPlayers(query) { return (await this.api('/players?q='+encodeURIComponent(query))).players; }
  async apiKeyRequest(path='',options={}) {
    const account=this.getProfile()?.id,generation=this.generation;
    if(!account)throw new Error('请先登录');
    const result=await this.api('/me/api-keys'+path,{...options,account});
    if(generation!==this.generation||account!==this.getProfile()?.id)throw new Error('账号已切换，请回到原账号管理密钥。');
    return result;
  }
  getApiKeys() {return this.apiKeyRequest();}
  createApiKey(name) {return this.apiKeyRequest('',{method:'POST',body:{name}});}
  revokeApiKey(id) {return this.apiKeyRequest('/'+encodeURIComponent(id),{method:'DELETE'});}
  async getPlayerProfile(username) {
    const generation=this.generation,account=this.getProfile()?.id;
    const profile=await this.api('/players/'+encodeURIComponent(username));
    if(generation!==this.generation||account!==this.getProfile()?.id)throw new Error('账号已切换，请重新查看玩家资料。');
    return profile;
  }
  getGameLevels() { return [...this.getOfficialLevels(),...this.getCommunityLevels().filter(level=>level.featured)]; }
  async deleteLevel(key) {
    const account = this.getProfile()?.id, generation = this.generation, level = this.getLevel(key);
    if (!account) throw new Error('请先登录');
    if (!level) throw new Error('关卡不存在');
    if (level.source !== 'community' || level.authorId !== account) throw new Error('只能删除自己发布的关卡');
    await this.flush();
    if (generation !== this.generation || account !== this.getProfile()?.id) throw new Error('账号已切换，请重试。');
    await this.api('/levels/' + encodeURIComponent(key), { method: 'DELETE', account });
    if (generation !== this.generation || account !== this.getProfile()?.id) throw new Error('账号已切换，请回到原账号查看作品。');
    this.boards.delete(key);
    this.data.levels = this.data.levels.filter(item => levelKey(item) !== key);
    delete this.data.progress[key]; delete this.data.records[key];
    if (this.data.completions) delete this.data.completions[key];
    this.emit(true);
    await this.refresh(true);
  }
  close() { clearTimeout(this.timer);this.stream?.close();this.channel?.close(); }
}

export async function createService(options) {
  const response = await fetch('/api/health', { cache:'no-store',signal:AbortSignal.timeout(8000) });
  if (response.status === 404) return new LocalService({onStorageError:()=>options.onError('浏览器未能保存数据，请导出题目与解法备份。')});
  if (!response.ok) throw new Error('无法连接游戏服务，请稍后重试。');
  const health = await response.json();
  if (health.mode !== 'online') throw new Error('游戏服务返回了无效响应。');
  const service = new RemoteService(options);
  try { await service.refresh(); } catch(error) {service.close();throw error;}
  return service;
}
