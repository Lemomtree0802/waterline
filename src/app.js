import { Engine as E } from './engine.js';
import { GameSession, fraction } from './game.js';
import { Graph, graphThumbnail, positionsFor } from './graph.js';
import { levelKey } from './service.js';
import { createService } from './remote-service.js';
import { EditorHistory, graphSnapshot, connectNodes, removeNode, tidyLayout, newDraft } from './editor.js';
import { createSceneTransitions } from './scene.js';
import { HomeWordmark } from './home-wordmark.js';
import { SubmissionGuide } from './submission-guide.js';
import { apiKeysContent, mountApiKeys } from './api-keys.js';
import { compactWater } from './water-text.js';

const $ = selector => document.querySelector(selector);
const main = $('#main'), modal = $('#modal');
const sceneTransitions = createSceneTransitions({main, header: $('.site-header'), footer: $('.site-footer'), curtain: $('#scene-curtain')});

const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', undo: '<path d="m8 5-4 4 4 4M4 9h10a6 6 0 0 1 0 12"/>', redo: '<path d="m16 5 4 4-4 4m4-4H10a6 6 0 0 0 0 12"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>', trophy: '<path d="M8 4h8v7a4 4 0 0 1-8 0V4Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 0h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>', edit: '<path d="m15 4 5 5-10 10-6 1 1-6L15 4Zm-2 2 5 5"/>',
  link: '<path d="m9 15 6-6m-8 4-2 2a4 4 0 0 0 6 6l3-3a4 4 0 0 0 0-6m3-1 2-2a4 4 0 0 0-6-6l-3 3a4 4 0 0 0 0 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', move: '<path d="M12 3v18M3 12h18m-6-6-3-3-3 3m6 12-3 3-3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>', download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4m0 3v1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  leaf: '<path d="M5 19C1 9 9 3 21 3c0 12-6 20-16 16Zm0 0L16 8"/>', compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5 5-3Z"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
const routeHref = level => `#play/${encodeURIComponent(levelKey(level))}`;
let toastTimeout;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('#toast').classList.remove('show'), 4200); }
main.innerHTML = '<section class="page empty-state"><p role="status">正在连接水路…</p></section>';
let service;
try { service = await createService({onError:message=>toast(message)}); }
catch(error) {
  main.innerHTML = `<section class="page empty-state"><h1>暂时无法连接</h1><p>${html(error.message)}</p><button class="button primary" onclick="location.reload()">重新连接</button></section>`;
  throw error;
}
$('#profile-button').setAttribute('aria-label','玩家账号');
$('#connection-label').textContent = service.online ? '已联网' : '本地预览';
let graph = null, homeGraph = null, game = null, currentLevel = null, currentRoute = '', trial = false, decimal = service.getPreferences().decimal;
const levelsPerPage = 6;
const officialPerPage = 24;
let officialPage = 0;
let workshopIndex = 0, workshopFilter = '全部', workshopQuery = '';
let draft = null, selectedNode = null, selectedEdge = null, linkStart = null, dragged = false, dragState = null;
let editorHistory = null, editorMessage = '';
let gameDisposers = [], pendingProfileAction = null, submitting = false;
let referencePlayback = null, replayTimer = null, guide = null, leaderboardOffset = 0, playerSearchToken = 0;
const profileViews = new Map();
let apiKeyManager=null;

function restoredSession(level) { return new GameSession(level); }

function waterText(value) {
  if (!value) return '';
  const info = E.decimalInfo(value, 4);
  const text=decimal ? `${info.exact ? '' : '≈'}${info.text}` : E.str(value);
  return text.length>24 ? `≈${compactWater(value)}` : text;
}

function referenceMoves(level) { return service.getMyRecord(levelKey(level))?.moves || []; }

function updateProfile() {
  const profile = service.getProfile();
  $('#profile-button').innerHTML = `${icon('user')}<span>${profile ? html(profile.name) : '登录'}</span>${profile ? `<span class="local-chip">${service.online ? '账号' : '本地'}</span>` : ''}`;
  $('#sync-status').hidden = !service.status || service.status === '正在同步…';
  $('#sync-message').textContent = service.status || '';
}
let activeProfileId = service.getProfile()?.id || null;
let activeDraftSnapshot = JSON.stringify(service.getDraft());
service.subscribe(external => {
  const nextId=service.getProfile()?.id || null,changed=nextId!==activeProfileId;
  const nextDraft=JSON.stringify(service.getDraft());
  if(changed) {
    if(apiKeyManager){apiKeyManager.destroy();apiKeyManager=null;modal.close();}
    activeProfileId=nextId;decimal=service.getPreferences().decimal;profileViews.clear();
    if(currentRoute.startsWith('player/')){main.innerHTML='<section class="page empty-state"><p role="status">正在读取玩家资料…</p></section>';void renderRoute();}
    if(game&&!trial&&!pendingProfileAction){ referencePlayback=null;clearTimeout(replayTimer);game=new GameSession(currentLevel);updateGame(false);renderReferenceControls(); }
    if(currentRoute==='home'){homeGraph?.destroy();home();}
  }
  if(currentRoute==='create'&&!pendingProfileAction&&(changed||(external&&nextDraft!==activeDraftSnapshot))){draft=service.getDraft();cleanRoute();editorPage();}
  activeDraftSnapshot=nextDraft;updateProfile();
  if(external&&currentLevel?.source==='community'&&!trial&&!service.getLevel(levelKey(currentLevel)))location.hash='#workshop';
  if(currentRoute==='levels')renderLevelCards();
  if(currentRoute==='workshop')renderWorkshopCards();
  if($('#leaderboard'))renderLeaderboard();
});

updateProfile();

function showModal(title, body, { wide = false, onClose, kind = '' } = {}) {
  apiKeyManager?.destroy();apiKeyManager=null;
  if (modal.open) modal.close();
  guide?.pause();
  modal.classList.toggle('wide-modal', wide);
  modal.dataset.kind = kind;
  modal.innerHTML = `<div class="modal-heading"><h2 id="modal-title">${html(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div>${body}`;
  modal.onclose = () => { pendingProfileAction = null; onClose?.(); guide?.resume(); };
  modal.showModal();
}
modal.addEventListener('click', event => { if (event.target === modal) { const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) modal.close(); } });
modal.addEventListener('close', () => { if (!modal.open) {pendingProfileAction = null;apiKeyManager?.destroy();apiKeyManager=null;} });

function apiKeysModal() {
  if(!service.online||!service.getProfile())return profileModal();
  showModal('API Key',apiKeysContent(),{kind:'api-keys',wide:true});
  apiKeyManager=mountApiKeys(modal.querySelector('.api-key-manager'),service,{notify:toast});
}

function profileModal(action, mode = 'login') {
  if (service.online) {
    const profile = service.getProfile();
    showModal(profile ? '玩家账号' : mode === 'register' ? '注册玩家' : '登录玩家', `<div class="modal-body">${profile ? `<p class="account-name">${html(profile.username)}</p><p class="muted">最佳成绩和草稿随账号保存，已发布的关卡对所有玩家开放。</p><button class="button quiet full" data-action="api-keys">API Key</button><button class="button quiet full" data-action="retry-sync">重新同步</button><button class="text-button full" data-action="export-pending">导出本机未同步修改</button><button class="text-button full" data-action="cloud-confirm">使用云端进度与草稿</button><button class="text-button sign-out" data-action="sign-out">退出登录</button>` : `<form id="profile-form" data-mode="${mode}"><label for="username">用户名</label><input id="username" name="username" minlength="3" maxlength="24" required autocomplete="username" placeholder="3–24 个字母、汉字、数字或下划线"><label for="password">密码</label><input id="password" name="password" type="password" minlength="8" maxlength="128" required autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" placeholder="至少 8 个字符"><p id="profile-error" class="form-error" role="alert"></p><button class="button primary full" type="submit">${mode === 'register' ? '注册' : '登录'}${action ? '并继续' : ''}</button></form><button class="text-button full auth-switch" data-action="auth-mode" data-mode="${mode === 'register' ? 'login' : 'register'}">${mode === 'register' ? '已有账号？去登录' : '还没有账号？注册'}</button>`}</div>`);
    pendingProfileAction = action || null; return;
  }
  showModal('本地玩家', `<div class="modal-body"><p class="muted">前端体验阶段，身份与成绩保存在此浏览器。</p><form id="profile-form"><label for="nickname">玩家昵称</label><input id="nickname" name="nickname" maxlength="20" required autocomplete="nickname" placeholder="给自己起个名字"><p id="profile-error" class="form-error" role="alert"></p><button class="button primary full" type="submit">${action ? '创建玩家并继续' : '创建玩家'}</button></form>${service.getProfiles().length ? `<div class="existing-players"><span class="small-label">切换玩家</span>${service.getProfiles().map(p => `<button class="player-option" data-action="switch-profile" data-id="${html(p.id)}"><span class="avatar">${html(p.name.slice(0, 1))}</span>${html(p.name)}${p.id === service.getProfile()?.id ? icon('check') : icon('arrow')}</button>`).join('')}</div>` : ''}<button class="text-button full" data-action="export-local">导出本机玩家记录</button>${service.getProfile() ? '<button class="text-button sign-out" data-action="sign-out">退出，使用访客身份</button>' : ''}</div>`);
  pendingProfileAction = action || null;
}

function rulesModal() {
  showModal('怎么玩','<div class="modal-body rules"><p>开阀，让连在一起的圆圈平均分水；关阀，留下各自的水量。</p><p>红色圆圈中的水量就是你的成绩。提交成绩，保留你的最好记录。</p><button class="button primary full" data-action="close-modal">返回游戏</button></div>');
}

function home() {
  main.innerHTML=`<section class="home-page page"><div class="title-scene"><h1>水衡<span class="sr-only"> Waterline</span></h1><div class="home-demo wordmark-demo"><svg id="home-wordmark" class="wordmark-graph" aria-label="可自由开关阀门的 WATERLINE 字形水路"></svg></div></div><nav class="game-menu" aria-label="游戏菜单"><a class="menu-start" href="#levels">进入游戏</a><a href="#workshop">创意工坊</a><button data-action="about">关于</button></nav></section>`;
  homeGraph=new HomeWordmark($('#home-wordmark'));
}

function pager(page, count, action, perPage=levelsPerPage) {
  const pages = Math.ceil(count / perPage);
  return pages > 1 ? `<nav class="level-pagination" aria-label="关卡翻页"><button class="icon-button" data-action="${action}" data-page="${page - 1}" aria-label="上一页" ${page === 0 ? 'disabled' : ''}>${icon('back')}</button><span>${page + 1} / ${pages}</span><button class="icon-button" data-action="${action}" data-page="${page + 1}" aria-label="下一页" ${page + 1 === pages ? 'disabled' : ''}>${icon('arrow')}</button></nav>` : '';
}
function levelsPage() {
  main.innerHTML='<section class="page levels-page"><div class="page-heading"><h1>选择关卡</h1><a href="#home" class="text-button">返回菜单</a></div><div id="level-cards" class="stage-grid"></div><div id="official-pages"></div></section>';
  renderLevelCards();
}
function renderLevelCards() {
  const levels=service.getGameLevels();
  officialPage=Math.max(0,Math.min(officialPage,Math.ceil(levels.length/officialPerPage)-1));
  $('#level-cards').innerHTML=levels.slice(officialPage*officialPerPage,(officialPage+1)*officialPerPage).map((level,index)=>{
    const i=officialPage*officialPerPage+index;
    const key=levelKey(level),record=service.getMyRecord(key),rank=service.getRank(key);
    return `<a class="stage-card stage-tone-${i%3}" href="${routeHref(level)}"><h2>${html(level.source==='official'?level.name:'第'+(i+1)+'关')}</h2>${level.source==='community'?`<span class="stage-author">出题者 ${html(level.authorUsername || level.authorName)}</span>`:''}<div class="stage-results"><p>你的最佳成绩：<strong>${record?html(waterText(fraction(record.score))):'？'}</strong></p><p>你的当前排名：<strong>${rank?'第 '+rank+' 名':'？'}</strong></p></div></a>`;
  }).join('');
  $('#official-pages').innerHTML=pager(officialPage,levels.length,'official-page',officialPerPage);
}

function workshopPage() {
  main.innerHTML=`<section class="page workshop-page"><div class="page-heading"><h1>创意工坊</h1><div class="workshop-actions">${service.getDraft()?'<a class="text-button" href="#create">继续草稿</a>':''}<button class="button primary" data-action="blank-draft">${icon('plus')} 创建关卡</button></div></div><div class="list-toolbar"><div class="segmented" aria-label="工坊筛选">${['全部','我的关卡'].map(f=>`<button data-action="workshop-filter" data-filter="${f}" aria-pressed="${workshopFilter===f}">${f}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="workshop-search" type="search" placeholder="搜索玩家 ID" aria-label="搜索玩家 ID" value="${html(workshopQuery)}"></label></div><div id="workshop-players" class="player-search-results" aria-live="polite"></div><div id="workshop-cards" class="level-grid"></div><div id="workshop-pages"></div></section>`;
  renderWorkshopCards();renderPlayerSearch();
}
function workshopCard(level) {
  return `<article class="level-card community-card"><a class="community-play" href="${routeHref(level)}"><div class="level-card-name"><h2>${html(level.name)}</h2></div><div class="thumbnail-wrap">${graphThumbnail(level)}</div></a><div class="community-caption"><a class="creator" href="#player/${encodeURIComponent(level.authorUsername || level.authorName)}">${html(level.authorUsername || level.authorName)}</a>${level.authorId===service.getProfile()?.id?`<button class="icon-button danger" data-action="delete-level" data-key="${html(levelKey(level))}" aria-label="删除 ${html(level.name)}">${icon('trash')}</button>`:''}</div></article>`;
}
function renderWorkshopCards() {
  const query=workshopQuery.trim().toLowerCase();
  const levels=service.getCommunityLevels().filter(level=>(workshopFilter==='全部'||level.authorId===service.getProfile()?.id)&&(!query||(level.authorUsername || level.authorName || '').toLowerCase().includes(query)||level.name.toLowerCase().includes(query)));
  workshopIndex=Math.max(0,Math.min(workshopIndex,Math.ceil(levels.length/levelsPerPage)-1));
  $('#workshop-cards').innerHTML=levels.length?levels.slice(workshopIndex*levelsPerPage,(workshopIndex+1)*levelsPerPage).map(workshopCard).join(''):'<div class="empty-state"><p>暂无关卡</p><button class="button primary" data-action="blank-draft">创建关卡</button></div>';
  $('#workshop-pages').innerHTML=pager(workshopIndex,levels.length,'workshop-page');
}
async function renderPlayerSearch() {
  const query=workshopQuery.trim(),token=++playerSearchToken,container=$('#workshop-players');
  if(!container)return;
  container.innerHTML='';if(!query || query.length>24)return;
  try {
    const players=await service.searchPlayers(query);
    if(token!==playerSearchToken||currentRoute!=='workshop')return;
    container.innerHTML=players.map(player=>`<a class="player-result" href="#player/${encodeURIComponent(player.username)}">${icon('user')}<span>${html(player.username)}</span>${icon('arrow')}</a>`).join('');
  }catch(error){if(token===playerSearchToken)container.textContent=error.message;}
}
function playerPage(profile) {
  main.innerHTML=`<section class="page player-page"><div class="page-heading"><h1>${html(profile.player.username)}</h1><a class="text-button" href="#workshop">创意工坊</a></div><h2>成绩</h2><div class="score-table-wrap"><table class="score-table"><thead><tr><th>关卡</th><th>排名</th><th>成绩</th></tr></thead><tbody>${profile.records.map(row=>`<tr><td><a href="#play/${encodeURIComponent(row.key)}">${html(row.name)}</a></td><td>${row.rank}</td><td>${row.score===null?'？':html(waterText(fraction(row.score)))}</td></tr>`).join('')||'<tr><td colspan="3">暂无成绩</td></tr>'}</tbody></table></div><h2 class="player-levels-heading">发布的关卡</h2><div class="level-grid">${profile.levels.map(workshopCard).join('')||'<p class="muted">暂无关卡</p>'}</div></section>`;
}

function numberFormatLabel() {
  return `<span class="${!decimal ? 'active' : ''}">分数</span><span class="format-divider">/</span><span class="${decimal ? 'active' : ''}">小数</span>`;
}
function boardPage(level,isTrial=false) {
  currentLevel=level;trial=isTrial;game=new GameSession(level);leaderboardOffset=0;
  const record=service.getMyRecord(levelKey(level));
  main.innerHTML=`<section class="page game-page"><div class="game-heading"><a class="back-link" href="${isTrial?'#create':'#levels'}">${icon('back')}${isTrial?'返回编辑':'返回菜单'}</a><h1>${isTrial?'试玩':html(level.name)}</h1></div>${!isTrial&&level.description?`<p class="player-message">${html(level.description)}</p>`:''}<section class="board-panel"><div class="board-top"><div class="puzzle-objective" role="group" aria-label="当前成绩"><output id="target-score" class="target-score">0</output><span id="target-decimal" class="sr-only"></span></div></div><div class="graph-scroller" role="region" aria-label="水路画板"><svg id="game-graph" class="graph" aria-label="水路，点击阀门打开或关闭"></svg></div><div id="reference-controls" class="reference-controls" hidden><button class="text-button" data-action="reference-back">上一步</button><button class="text-button" data-action="reference-play">暂停</button><output id="reference-step"></output><button class="text-button" data-action="reference-next">下一步</button><button class="text-button" data-action="reference-exit">退出回放</button></div><div class="board-controls"><div class="history-buttons"><button id="undo" class="icon-button" data-action="undo" aria-label="撤销一步">${icon('undo')}</button><button id="redo" class="icon-button" data-action="redo" aria-label="重做一步">${icon('redo')}</button><button class="icon-button" data-action="reset-game" aria-label="重新挑战">${icon('reset')}</button></div><div class="board-settings"><button class="text-button number-toggle" data-action="toggle-decimal" aria-label="切换分数和小数" aria-pressed="${decimal}">${numberFormatLabel()}</button><button class="icon-button" data-action="rules" aria-label="游戏规则">${icon('help')}</button></div><div class="board-navigation">${isTrial?'':'<button id="best-replay" class="text-button" data-action="my-best" hidden>回放最佳</button><button id="board-leaderboard" class="text-button" data-action="leaderboard" hidden>排行榜</button><button id="submit-score" class="button primary submit-main" data-action="submit">提交成绩</button>'}</div></div></section></section>`;
  graph=new Graph($('#game-graph'),level,{onValve:act,fixedNodes:true});updateGame(false);
  if(!isTrial&&level.id==='intro'&&!record) {
    guide=new SubmissionGuide({valve:graph.valveElements[0],node:graph.nodeElements[level.t].querySelector('.node-base'),submit:$('#submit-score')});
  }
}
function act(k) {
  if(sceneTransitions.busy||modal.open||graph.busy||referencePlayback||guide?.stage==='submit')return;
  const info=E.inspectMove(game.level,game.state,k);game.act(k);
  const settled=updateGame();graph.showMove(info);
  if(guide?.stage==='valve')settled.then(done=>{if(done&&game&&currentLevel?.id==='intro')guide?.advance();});
}
function updateGame(animate=true) {
  if(!game||!$('#target-score'))return Promise.resolve(false);
  const settled=graph.update(game.state,decimal,animate),exact=E.str(game.score),info=E.decimalInfo(game.score,6);
  const scoreText=decimal?(info.exact?'':'≈')+info.text:exact;
  $('#target-score').textContent=scoreText.length>24?'≈'+compactWater(game.score):scoreText;
  $('#target-score').title=exact;
  $('#target-score').classList.toggle('long-score',$('#target-score').textContent.length>10);
  $('#target-decimal').textContent=decimal?'精确值 '+exact:info.text;
  $('#undo').disabled=Boolean(referencePlayback)||!game.canUndo;$('#redo').disabled=Boolean(referencePlayback)||!game.canRedo;
  const record=service.getMyRecord(levelKey(game.level));
  if($('#submit-score'))$('#submit-score').disabled=submitting||Boolean(referencePlayback);
  if($('#best-replay'))$('#best-replay').hidden=!record;
  if($('#board-leaderboard'))$('#board-leaderboard').hidden=!record;
  renderLeaderboard();return settled;
}
function renderLeaderboard() {
  const container=$('#leaderboard');if(!container||!currentLevel)return;
  const key=levelKey(currentLevel),board=service.online?service.boards.get(key):service.getBoard(key,leaderboardOffset);
  if(!board?.unlocked){container.innerHTML='<p class="muted">提交成绩后查看排行榜</p>';return;}
  const rows=board.records || [];
  container.innerHTML=`<div class="score-table-wrap"><table class="score-table"><thead><tr><th>排名</th><th>玩家 ID</th><th>成绩</th></tr></thead><tbody>${rows.map(row=>`<tr ${row.isMine?'class="is-mine"':''}><td>${row.rank}</td><td><a href="#player/${encodeURIComponent(row.playerId)}" data-action="close-modal">${html(row.playerId)}</a></td><td>${row.score===null?'？':html(waterText(fraction(row.score)))}</td></tr>`).join('')}</tbody></table></div>${board.total>board.limit?`<div class="ranking-pages"><button class="text-button" data-action="ranking-page" data-offset="${Math.max(0,board.offset-board.limit)}" ${board.offset===0?'disabled':''}>上一页</button><span>${Math.floor(board.offset/board.limit)+1} / ${Math.ceil(board.total/board.limit)}</span><button class="text-button" data-action="ranking-page" data-offset="${board.offset+board.limit}" ${board.offset+board.limit>=board.total?'disabled':''}>下一页</button></div>`:''}`;
}
async function showLeaderboard(offset=0) {
  if(!game||trial||!service.getMyRecord(levelKey(currentLevel)))return;
  const session=game;await service.loadLeaderboard(levelKey(currentLevel),offset);if(game!==session)return;
  leaderboardOffset=offset;showModal('排行榜','<div class="modal-body" id="leaderboard"></div>',{wide:true,kind:'ranking'});renderLeaderboard();
}
async function submitScore() {
  if(submitting||!game||trial||referencePlayback||graph.busy)return;
  if(!service.getProfile()){profileModal(submitScore);return;}
  submitting=true;$('#submit-score').disabled=true;const session=game;
  try {
    const result=await service.submitRun({key:levelKey(session.level),moves:session.activeMoves});
    if(game!==session)return;
    guide?.destroy();guide=null;updateGame(false);
    const levels=service.getGameLevels(),index=levels.findIndex(level=>levelKey(level)===levelKey(currentLevel)),next=index>=0?levels[index+1]:null;
    showModal('成绩已提交',`<div class="modal-body score-result-body"><p class="score-result-caption">${result.improved?'你的成绩达到了所有玩家成绩列表中的':'你的最佳成绩在所有玩家成绩列表中排名'}</p><p class="score-result-rank">第 <strong>${html(result.rank)}</strong> 名</p>${result.improved?'':'<p class="score-result-retained">已保留最好一次的成绩</p>'}<div class="score-result-actions"><a class="button primary" href="${next?routeHref(next):'#levels'}" data-action="close-modal">${next?'进入下一关':'返回菜单'}</a><button class="button quiet" data-action="retry-level">重新挑战</button><button class="text-button" data-action="leaderboard">排行榜</button></div></div>`,{kind:'score'});
  }catch(error){toast(error.message);}
  finally{submitting=false;if(game===session&&$('#submit-score'))$('#submit-score').disabled=false;}
}
async function publishDraft(snapshot) {
  if(submitting)return;
  if(!snapshot){if(!saveWater())return;draft.description=$('#draft-description').value.trim();snapshot=structuredClone(draft);}
  try {E.validate(snapshot);}catch(error){$('#editor-error').textContent=error.message;return;}
  if(!service.getProfile()){profileModal(()=>publishDraft(snapshot));return;}
  submitting=true;const button=$('[data-action="publish-draft"]');if(button)button.disabled=true;
  try {
    await service.publishLevel(snapshot,[]);draft=null;workshopFilter='我的关卡';workshopQuery='';workshopIndex=0;location.hash='#workshop';
  }catch(error){toast(error.message);}
  finally{submitting=false;if(button?.isConnected)button.disabled=false;}
}

function storeDraft() { service.saveDraft(draft); }
function editorPage() {
  draft = draft || service.getDraft() || newDraft();
  delete draft.goalWater;
  try {
    if (!Array.isArray(draft.w) || draft.w.length > 10) throw Error();
    draft.w.forEach(E.parse); draft.pos = positionsFor({ ...draft, source: 'draft' });
  } catch { draft = newDraft(); }
  clearEditorSelection(); editorHistory = new EditorHistory(); editorMessage = '';
  main.innerHTML = `<section class="page editor-page">
    <div class="game-heading"><div><a class="back-link" href="#workshop">${icon('back')} 创意工坊</a><h1>创建关卡</h1></div><button class="button quiet" data-action="new-draft">清空画布</button></div>
    <div class="editor-layout"><section class="editor-board-panel">
      <div class="editor-toolbar">
        <div class="editor-creation-actions"><button id="add-node" class="button quiet" data-action="add-node">${icon('plus')} 添加节点</button><button class="button quiet" data-action="tidy-layout" title="校正接近水平、垂直的连线，保留斜线">${icon('grid')} 一键整理</button></div>
        <div class="editor-actions"><button id="editor-undo" class="icon-button" data-action="editor-undo" aria-label="撤销编辑">${icon('undo')}</button><button id="editor-redo" class="icon-button" data-action="editor-redo" aria-label="重做编辑">${icon('redo')}</button><span class="control-separator"></span><button id="delete-selection" class="button quiet danger" data-action="delete-selection">${icon('trash')}<span>删除</span></button></div>
      </div>
      <div class="graph-scroller editor-scroller"><svg id="editor-graph" class="graph editor-graph" aria-label="关卡编辑画布：双击添加节点，拖动节点移动，依次点击两个节点连线，点击边选中"></svg><div id="empty-canvas" class="empty-canvas" aria-hidden="true"><span>双击画布，添加节点</span></div>
        <div id="node-inspector" class="canvas-node-editor" role="group" aria-label="节点设置" hidden>

          <label for="initial-water">初始水量</label><div class="canvas-node-fields"><input id="initial-water" inputmode="decimal" aria-describedby="water-help node-water-error"><button id="set-target" class="button quiet" data-action="set-selected-target">${icon('target')} 计分</button></div>
          <span id="water-help" class="input-hint">支持整数、小数或分数，如 3/4。</span>
          <p id="node-water-error" class="form-error" role="alert"></p>
        </div>
      </div>
      <div class="editor-bottom"><span id="editor-help" role="status" aria-live="polite"></span><span id="editor-count" class="tiny-mono"></span></div>
      <p id="editor-error" class="form-error" role="alert"></p>
    </section><aside class="editor-inspector"><section class="inspector-card">

      <label for="draft-description">留给玩家的话 <span class="optional">可选</span></label><textarea id="draft-description" maxlength="100" rows="2" placeholder="可选">${html(draft.description)}</textarea>
      <div class="editor-publish-actions"><button class="button quiet" data-action="trial">试玩</button><button class="button primary" data-action="publish-draft">发布</button></div>
    </section></aside></div></section>`;
  renderEditorGraph();
  const svg = $('#editor-graph');
  const point = event => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const down = event => {
    const node = event.target.closest('[data-node]');
    if (!node || event.button !== 0 || !event.isPrimary) return;
    const p = point(event), i = Number(node.dataset.node);
    dragged = false; dragState = { i, pointerId: event.pointerId, start: [p.x, p.y], screen: [event.clientX, event.clientY], pos: draft.pos[i].slice(), before: graphSnapshot(draft) };
  };
  const move = event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (!dragged && Math.hypot(event.clientX - dragState.screen[0], event.clientY - dragState.screen[1]) < 5) return;
    if (!dragged) {
      if (!saveWater()) { dragState = null; return; }
      dragState.before = graphSnapshot(draft);
      dragged = true; selectedNode = dragState.i; selectedEdge = null; linkStart = null;
      svg.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const p = point(event), dx = p.x - dragState.start[0], dy = p.y - dragState.start[1];
    draft.pos[dragState.i] = [Math.max(65, Math.min(735, dragState.pos[0] + dx)), Math.max(75, Math.min(405, dragState.pos[1] + dy))];
    renderEditorGraph();
  };
  const up = event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragged) {
      editorHistory.record(dragState.before, draft); editorMessage = '位置已保存';
      renderEditorGraph(); storeDraft();
    }
    dragState = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    // Capture is only enabled after a real drag. Ordinary clicks keep their node target.
    setTimeout(() => { dragged = false; if (currentRoute === 'create') updateInspector(); }, 0);
  };
  const keyboardMove = event => {
    const node = event.target.closest('[data-node]');
    if (!node || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const i = Number(node.dataset.node), step = event.shiftKey ? 24 : 12;
    selectedNode = i; selectedEdge = null; linkStart = null;
    editDraft(() => { draft.pos[i] = [Math.max(65, Math.min(735, draft.pos[i][0] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))), Math.max(75, Math.min(405, draft.pos[i][1] + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)))]; });
    svg.querySelector(`[data-node="${i}"]`).focus();
  };
  const clear = event => {
    if (!dragged && !event.target.closest('[data-node],[data-valve],[data-pipe],[data-editor-delete]') && saveWater()) { clearEditorSelection(); renderEditorGraph(); }
  };
  const addAtPointer = event => {
    if (event.target.closest('[data-node],[data-valve],[data-pipe],[data-editor-delete]')) return;
    const p = point(event); addEditorNode([p.x, p.y]);
  };
  svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('keydown', keyboardMove); svg.addEventListener('click', clear);
  svg.addEventListener('dblclick', addAtPointer);
  const scroller = $('.editor-scroller');
  const inspectorResize = new ResizeObserver(positionNodeEditor);
  inspectorResize.observe($('#node-inspector')); inspectorResize.observe(scroller);
  window.addEventListener('resize', positionNodeEditor); scroller.addEventListener('scroll', positionNodeEditor);
  gameDisposers.push(() => { inspectorResize.disconnect(); window.removeEventListener('resize', positionNodeEditor); scroller.removeEventListener('scroll', positionNodeEditor); });
  gameDisposers.push(() => { svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); svg.removeEventListener('keydown', keyboardMove); svg.removeEventListener('click', clear); svg.removeEventListener('dblclick', addAtPointer); dragState = null; });
}
function addEditorNode(position) {
  if (!saveWater() || draft.w.length >= 10) return;
  editDraft(() => {
    const i = draft.w.length;
    const candidates = [[280, 240], [520, 240], [400, 100], [400, 370], [160, 110], [640, 110], [160, 370], [640, 370]];
    const next = position || candidates.find(p => draft.pos.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= 80)) || [110 + i * 50, 140];
    draft.w.push('0'); draft.pos.push([Math.max(65, Math.min(735, next[0])), Math.max(75, Math.min(405, next[1]))]);
    if (i === 0) draft.t = 0;
    selectedNode = i; selectedEdge = null; linkStart = i;
  });
}
function clearEditorSelection() { selectedNode = null; selectedEdge = null; linkStart = null; editorMessage = ''; }
function editDraft(change) {
  const before = graphSnapshot(draft); change(); editorHistory.record(before, draft); renderEditorGraph(); storeDraft();
}
function restoreEditor(redo = false) {
  if (!saveWater() || !editorHistory[redo ? 'redo' : 'undo'](draft)) return;
  clearEditorSelection(); editorMessage = redo ? '已重做' : '已撤销'; renderEditorGraph(); storeDraft();
}
function deleteSelection() {
  if (selectedNode === null && selectedEdge === null || !saveWater()) return;
  editDraft(() => {
    if (selectedEdge !== null) draft.e.splice(selectedEdge, 1);
    else removeNode(draft, selectedNode);
    clearEditorSelection(); editorMessage = '已删除，可撤销';
  });
}
function renderEditorGraph() {
  graph?.destroy();
  graph = new Graph($('#editor-graph'), draft, { editable: true, onNode: editorNode, onValve: editorEdge, onDelete: deleteSelection });
  graph.highlight(selectedNode !== null ? [selectedNode] : []);
  graph.highlightEdge(selectedEdge);
  if (selectedNode !== null) graph.showDeleteControl(draft.pos[selectedNode], '删除选中的圆圈');
  else if (selectedEdge !== null) graph.showDeleteControl(graph.valves[selectedEdge], '删除选中的连线');
  $('#empty-canvas').hidden = draft.w.length > 0;
  $('#editor-help').textContent = linkStart !== null ? '再点一个节点连线' : editorMessage || (draft.w.length ? '拖动移动，点击两点连线' : '');
  $('#editor-count').textContent = `${draft.w.length}/10`;
  $('#add-node').disabled = draft.w.length >= 10;
  $('#editor-undo').disabled = !editorHistory.past.length; $('#editor-redo').disabled = !editorHistory.future.length;
  const canDelete = selectedEdge !== null || selectedNode !== null;
  $('#delete-selection').disabled = !canDelete;
  $('#delete-selection span').textContent = selectedEdge !== null ? '删除连线' : selectedNode !== null ? '删除节点' : '删除';
  updateInspector();
}
function updateInspector() {
  $('#node-inspector').hidden = selectedNode === null || dragged;
  if (selectedNode !== null) {

    const input = $('#initial-water');
    if (document.activeElement !== input || input.dataset.node !== String(selectedNode)) input.value = draft.w[selectedNode];
    input.dataset.node = String(selectedNode);
    $('#set-target').disabled = draft.t === selectedNode;
    positionNodeEditor();
  }
}
function positionNodeEditor() {
  const panel = $('#node-inspector'), canvas = $('.editor-scroller');
  if (!panel || panel.hidden || !canvas || selectedNode === null || !graph) return;
  const node = graph.nodeElements[selectedNode].querySelector('.node-base').getBoundingClientRect();
  const bounds = canvas.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight, gap = 14;
  const maxX = canvas.clientWidth - width - 10, maxY = canvas.clientHeight - height - 10;
  const centerX = (node.left + node.right) / 2 - bounds.left, centerY = (node.top + node.bottom) / 2 - bounds.top;
  const candidates = [[centerX - width / 2, node.bottom - bounds.top + gap], [centerX - width / 2, node.top - bounds.top - height - gap], [node.right - bounds.left + gap, centerY - height / 2], [node.left - bounds.left - width - gap, centerY - height / 2], [10, 10], [maxX, 10], [10, maxY], [maxX, maxY]];
  const nodes = graph.nodeElements.map(element => element.querySelector('.node-base').getBoundingClientRect());
  let best, bestScore = Infinity;
  for (const [x, y] of candidates) {
    const left = Math.max(10, Math.min(maxX, x)), top = Math.max(10, Math.min(maxY, y));
    const score = nodes.reduce((sum, rect, i) => {
      const overlapX = Math.max(0, Math.min(left + width, rect.right - bounds.left + 6) - Math.max(left, rect.left - bounds.left - 6));
      const overlapY = Math.max(0, Math.min(top + height, rect.bottom - bounds.top + 6) - Math.max(top, rect.top - bounds.top - 6));
      return sum + overlapX * overlapY * (i === selectedNode ? 20 : 1);
    }, 0);
    if (score < bestScore) { best = [left, top]; bestScore = score; }
    if (score === 0) break;
  }
  const [left, top] = best;
  panel.style.left = `${left + canvas.scrollLeft}px`; panel.style.top = `${top + canvas.scrollTop}px`;
}
function editorNode(i, event) {
  if (dragged || !saveWater()) return;
  const start = linkStart;
  selectedEdge = null; selectedNode = i; editorMessage = '';
  if (start === null) linkStart = i;
  else if (start === i) clearEditorSelection();
  else {
    linkStart = null;
    try {
      editDraft(() => { editorMessage = connectNodes(draft, start, i) ? '已连接' : '已有连线'; });
    } catch (error) { toast(error.message); }
  }
  renderEditorGraph();
  if (event?.type === 'keydown') graph.nodeElements[i].focus({ preventScroll: true });
}
function editorEdge(k, event) {
  if (dragged || !saveWater()) return;
  selectedEdge = k; selectedNode = null; linkStart = null;
  editorMessage = '点击 × 或按 Delete 删除'; renderEditorGraph();
  if (event?.type === 'keydown') graph.pipeElements[k].focus({ preventScroll: true });
}
function saveWater() {
  if (selectedNode === null) return true;
  try {
    const value = E.str(E.parse($('#initial-water').value));
    $('#editor-error').textContent = ''; $('#node-water-error').textContent = '';
    if (value !== draft.w[selectedNode]) editDraft(() => { draft.w[selectedNode] = value; });
    $('#initial-water').value = value; return true;
  } catch (error) { $('#node-water-error').textContent = error.message; positionNodeEditor(); return false; }
}

function beginTrial() {
  if(!saveWater())return;
  try {
    draft.description=$('#draft-description').value.trim();const valid=E.validate(draft);
    draft={...draft,...valid,name:'',id:'draft',source:'draft'};storeDraft();location.hash='#trial';
  }catch(error){$('#editor-error').textContent=error.message;}
}

function download(object, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function runExport() {
  return { schema: 'waterline-run-v1', puzzle: { id: game.level.id, name: game.level.name, w: game.level.w, e: game.level.e, t: game.level.t }, moves: game.activeMoves, score: E.str(game.score), ops: game.cursor, assisted: game.assisted };
}
async function fileText(file) { if (!file || file.size > 2_000_000) throw Error('请选择不超过 2 MB 的 JSON 文件。'); return file.text(); }

function startReference() {
  if(!game||referencePlayback)return;
  const moves=referenceMoves(currentLevel);modal.close();guide?.pause();
  referencePlayback={original:game,moves: moves.slice(),playing:true};
  game=new GameSession(currentLevel);graph.clearFeedback();updateGame(false);renderReferenceControls();scheduleReplay();
}
function renderReferenceControls() {
  if(!$('#reference-controls'))return;
  $('#reference-controls').hidden=!referencePlayback;if(!referencePlayback)return;
  $('#reference-step').textContent=`${game.cursor} / ${referencePlayback.moves.length}`;
  $('[data-action="reference-play"]').textContent=referencePlayback.playing?'暂停':'播放';
  $('[data-action="reference-back"]').disabled=game.cursor===0;
  $('[data-action="reference-next"]').disabled=game.cursor===referencePlayback.moves.length;
}
function scheduleReplay() {
  clearTimeout(replayTimer);if(!referencePlayback?.playing)return;
  if(game.cursor===referencePlayback.moves.length){referencePlayback.playing=false;renderReferenceControls();return;}
  replayTimer=setTimeout(async()=>{await stepReference(1,false);if(referencePlayback?.playing)scheduleReplay();},650);
}
async function stepReference(direction,manual=true) {
  if(!referencePlayback||graph.busy)return;
  if(manual){clearTimeout(replayTimer);referencePlayback.playing=false;}
  if(direction>0&&game.cursor<referencePlayback.moves.length){const edge=referencePlayback.moves[game.cursor],info=E.inspectMove(game.level,game.state,edge);game.act(edge);const settled=updateGame();graph.showMove(info);await settled;}
  else if(direction<0&&game.cursor>0){game.undo();graph.clearFeedback();updateGame(false);}
  renderReferenceControls();
}
function endReference() {
  if(!referencePlayback)return;clearTimeout(replayTimer);game=referencePlayback.original;referencePlayback=null;
  graph.clearFeedback();updateGame(false);renderReferenceControls();guide?.resume();
}

function historyAction(action) {
  if (!game || referencePlayback) return;
  graph.clearFeedback(); game[action](); updateGame(false);
}

function cleanRoute() {
  guide?.destroy();guide=null;clearTimeout(replayTimer);
  graph?.destroy(); graph = null; homeGraph?.destroy(); homeGraph = null;
  gameDisposers.forEach(dispose => dispose()); gameDisposers = [];
  referencePlayback = null;
  game = null; currentLevel = null; trial = false;
  if (modal.open) modal.close();
}
async function renderRoute() {
  if (location.hash === '#main') { main.focus(); return false; }
  let route;
  try { route = decodeURIComponent(location.hash.slice(1)) || 'home'; } catch { route = 'home'; }
  const applied = await sceneTransitions.run({
    animate: Boolean(currentRoute && route !== currentRoute),
    prepare: async () => {if(service.online)await service.prepareRoute(route);if(route.startsWith('player/'))profileViews.set(route,await service.getPlayerProfile(route.slice(7)));},
    mount: () => mountRoute(route),
    onError(error) {
      toast(error.message);
      if (!currentRoute) main.innerHTML = '<section class="page empty-state"><h1>同步需要处理</h1><p>本机修改已保留，可重试或在账号设置中处理冲突。</p><button class="button primary" data-action="retry-sync">重试同步</button><button class="text-button" data-action="profile-settings">账号设置</button></section>';
    },
  });
  if (applied) {
    main.focus({ preventScroll: true });
  }
  return applied;
}
function mountRoute(route) {
  // Redirect before disposing the visible scene so invalid drafts never flash blank.
  if (route === 'trial') {
    draft = draft || service.getDraft();
    try { E.validate(draft); } catch { location.hash = '#create'; return false; }
  }
  if (!['home', 'levels', 'workshop', 'create', 'trial'].includes(route) && !route.startsWith('play/') && !route.startsWith('player/')) {
    location.hash = '#home'; return false;
  }
  cleanRoute(); currentRoute = route;
  document.body.dataset.screen = route.startsWith('play/') || route === 'trial' ? 'play' : route;
  const source = route.startsWith('play/') ? service.getLevel(route.slice(5))?.source : null;
  const activeNav = route === 'home' ? 'home' : route === 'levels' || source === 'official' ? 'levels' : ['workshop', 'create', 'trial'].includes(route) || source === 'community' ? 'workshop' : null;
  $('.site-header').querySelectorAll('[data-nav]').forEach(a => {
    const active = a.dataset.nav === activeNav;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (route === 'home') home();
  else if (route === 'levels') levelsPage();
  else if (route === 'workshop') workshopPage();
  else if (route.startsWith('player/')) playerPage(profileViews.get(route));
  else if (route === 'create') editorPage();
  else if (route === 'trial') boardPage({ ...draft, source: 'draft' }, true);
  else if (route.startsWith('play/')) {
    const level = service.getLevel(route.slice(5));
    if (level) boardPage(level);
    else main.innerHTML = `<section class="page empty-state"><h1>这道水路暂时找不到了</h1><p>${service.online ? '请检查关卡链接或返回关卡列表。' : '关卡可能不在当前浏览器中。'}</p><a class="button primary" href="#levels">返回关卡</a></section>`;
  }
  document.title = currentLevel ? `${trial?'试玩':currentLevel.name} · 水衡 Waterline` : `${{ home: '水衡 Waterline', levels: '选择关卡 · 水衡', workshop: '创意工坊 · 水衡', create: '创建关卡 · 水衡' }[route] || '水衡 Waterline'}`;
  window.scrollTo({ top: 0, behavior: 'instant' });
  return true;
}
window.addEventListener('hashchange', renderRoute);

document.addEventListener('click', async event => {
  if (sceneTransitions.busy) return;
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === 'close-modal') modal.close();
    else if(action==='leaderboard') await showLeaderboard();
    else if(action==='ranking-page') await showLeaderboard(Number(button.dataset.offset));
    else if(action==='my-best')startReference();
    else if(action==='retry-level'){modal.close();guide?.destroy();guide=null;referencePlayback=null;clearTimeout(replayTimer);game=new GameSession(currentLevel);graph.clearFeedback();updateGame(false);renderReferenceControls();}
    else if(action==='publish-draft')await publishDraft();
    else if(action==='reference-play'){referencePlayback.playing=!referencePlayback.playing;renderReferenceControls();if(referencePlayback.playing)scheduleReplay();else clearTimeout(replayTimer);}
    else if (action === 'rules') rulesModal();
    else if (action === 'profile-settings') profileModal();
    else if (action === 'api-keys') apiKeysModal();
    else if (action === 'about') showModal('水衡 Waterline', `<div class="modal-body"><p>${service.getOfficialLevels().length} 道官方关卡，和玩家共同创作的水路。</p><p class="muted">${service.online ? '最佳成绩随账号保存，相同成绩共用一个名次。' : '本地预览：记录保存在此浏览器。'}</p><button class="button primary full" data-action="close-modal">继续探索</button></div>`);
    else if (action === 'auth-mode') profileModal(pendingProfileAction, button.dataset.mode);
    else if (action === 'retry-sync') { await service.flush(); await renderRoute(); toast('已同步。'); }
    else if (action === 'import-backup') $('#legacy-file').click();
    else if (action === 'export-local') download(service.exportLocal(),'水衡-本机玩家记录.json');
    else if (action === 'export-pending') download(service.pendingBackup(), '水衡-未同步修改.json');
    else if (action === 'cloud-confirm') showModal('使用云端记录？', '<div class="modal-body"><p>本机未同步修改会被替换。请先导出修改或当前解法。</p><div class="modal-actions"><button class="button quiet" data-action="close-modal">取消</button><button class="button primary" data-action="use-cloud">使用云端记录</button></div></div>');
    else if (action === 'use-cloud') { await service.useCloud(); draft=null; await renderRoute(); toast('已使用云端记录。'); }
    else if (action === 'import-local') { const result=await service.importLocal($('#legacy-player').value); draft=null; await renderRoute(); toast(`已导入 ${result.imported} 道关卡进度。`); }
    else if (action === 'workshop-page') { workshopIndex = Number(button.dataset.page); renderWorkshopCards(); main.focus({preventScroll:true}); }
    else if (action === 'official-page') { officialPage=Number(button.dataset.page);renderLevelCards();$('#level-cards').scrollIntoView({block:'start'}); }
    else if (action === 'workshop-filter') { workshopIndex = 0; workshopFilter = button.dataset.filter; document.querySelectorAll('[data-action="workshop-filter"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === workshopFilter))); renderWorkshopCards(); }
    else if (action === 'switch-profile') {
      const callback = pendingProfileAction; service.switchProfile(button.dataset.id); modal.close();
      if (!callback && currentLevel && !trial) { referencePlayback = null; game = restoredSession(currentLevel); graph.clearFeedback(); updateGame(false, false); renderReferenceControls(); }
      if (currentRoute === 'workshop') renderWorkshopCards();
      if (currentRoute === 'levels') levelsPage(); callback?.();
    } else if (action === 'sign-out') { if(service.online) await service.logout(); else service.switchProfile(null); modal.close(); if (currentLevel && !trial) { referencePlayback = null; game = restoredSession(currentLevel); graph.clearFeedback(); updateGame(false, false); renderReferenceControls(); } if (currentRoute === 'levels') levelsPage(); if (currentRoute === 'workshop') renderWorkshopCards(); }
    else if (action === 'undo' || action === 'redo') historyAction(action);
    else if (action === 'reset-game') historyAction('reset');
    else if (action === 'toggle-decimal') { decimal = !decimal; service.setPreferences({ decimal }); button.setAttribute('aria-pressed', String(decimal)); button.innerHTML = numberFormatLabel(); updateGame(false); }
    else if (action === 'reference-back') stepReference(-1);
    else if (action === 'reference-next') stepReference(1);
    else if (action === 'reference-exit') endReference();
    else if (action === 'submit') submitScore();
    else if (action === 'add-node') addEditorNode();
    else if (action === 'delete-selection') deleteSelection();
    else if (action === 'tidy-layout') {
      if (!saveWater()) return;
      let changed;
      editDraft(() => { changed = tidyLayout(draft); linkStart = null; editorMessage = changed ? '布局已整理，可以撤销恢复。' : '当前布局无需调整。'; });
      toast(editorMessage);
    }
    else if (action === 'editor-undo' || action === 'editor-redo') restoreEditor(action === 'editor-redo');
    else if (action === 'set-selected-target') {
      if (selectedNode === null || !saveWater()) return;
      editDraft(() => { draft.t = selectedNode; linkStart = null; });
    }
    else if (action === 'trial') beginTrial();
    else if (action === 'blank-draft' && !service.getDraft()?.w?.length && !service.getDraft()?.name && !service.getDraft()?.description) { draft = newDraft(); storeDraft(); location.hash = '#create'; }
    else if (action === 'new-draft' || action === 'blank-draft') showModal('从空白画布开始？', '<div class="modal-body"><p class="muted">当前草稿会被替换。</p><div class="modal-actions"><button class="button quiet" data-action="close-modal">取消</button><button class="button primary" data-action="confirm-new-draft">空白画布</button></div></div>');
    else if (action === 'confirm-new-draft') { modal.close(); draft = newDraft(); selectedNode = null; storeDraft(); if (currentRoute === 'create') { cleanRoute(); editorPage(); } else location.hash = '#create'; }
    else if (action === 'delete-level') {
      const level = service.getLevel(button.dataset.key);
      if (!level || level.authorId !== service.getProfile()?.id) return;
      showModal('删除关卡？', `<div class="modal-body"><p>${html(level.name)}</p><div class="modal-actions"><button class="button quiet" data-action="close-modal">取消</button><button class="button quiet danger" data-action="confirm-delete-level" data-key="${html(levelKey(level))}">删除</button></div></div>`);
    } else if (action === 'confirm-delete-level') {
      button.disabled = true;
      try { await service.deleteLevel(button.dataset.key); modal.close(); renderWorkshopCards(); }
      finally { if (button.isConnected) button.disabled = false; }
    }
    else if (action === 'export-run') download(runExport(), `水衡-${game.level.name}-解法.json`);
    else if (action === 'import-run') $('#run-file').click();
    else if (action === 'reference') startReference();
  } catch (error) { toast(error.message); }
});
$('#profile-button').addEventListener('click', () => profileModal());
document.addEventListener('submit', async event => {
  if (event.target.id !== 'profile-form') return;
  event.preventDefault();
  const submit = event.target.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    const callback = pendingProfileAction;
    if(service.online) await service.authenticate(event.target.dataset.mode,$('#username').value,$('#password').value);
    else service.createProfile($('#nickname').value);
    modal.close();
    if (callback && game && !trial) updateGame(false);
    if (currentRoute === 'levels') levelsPage();
    if (currentRoute === 'workshop') renderWorkshopCards();
    toast(service.online ? '已登录，记录随账号保存。' : '本地玩家已创建。'); callback?.();
  } catch (error) { if($('#profile-error')) $('#profile-error').textContent = error.message; }
  finally { if(submit.isConnected) submit.disabled=false; }
});
main.addEventListener('input', event => {
  if (event.target.id === 'workshop-search') { workshopIndex = 0; workshopQuery = event.target.value; renderWorkshopCards(); renderPlayerSearch(); }
  if (event.target.id === 'draft-description') { draft.description = event.target.value; storeDraft(); }
});
document.addEventListener('change', async event => {
  if (event.target.id === 'legacy-file') {
    try {
      const result=await service.importBackup(JSON.parse(await fileText(event.target.files[0])));
      draft=null;await renderRoute();toast(`已导入 ${result.imported} 道关卡进度。`);
    } catch(error) {toast('导入失败：'+error.message);}
    event.target.value=''; return;
  }
  if (event.target.id === 'initial-water') saveWater();
  if (event.target.id === 'run-file') {
    const session = game;
    try {
      const imported = E.importRun(JSON.parse(await fileText(event.target.files[0])));
      if (game !== session) return;
      if (E.key(imported.p) !== E.key(currentLevel)) throw Error('这份解法属于另一道题目。');
      referencePlayback = null; game = new GameSession(currentLevel, imported.moves, { assisted: true }); graph.clearFeedback(); updateGame(); renderReferenceControls();
    } catch (error) { toast('导入失败：' + error.message); }
    event.target.value = '';
  }
});
document.addEventListener('keydown', event => {
  if (sceneTransitions.busy) return;
  if (event.target.id === 'initial-water' && event.key === 'Enter') {
    event.preventDefault();
    if (saveWater()) { event.target.blur(); graph.nodeElements[selectedNode].focus({ preventScroll: true }); }
    return;
  }
  if (currentRoute === 'create' && !modal.open && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) {
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); restoreEditor(event.shiftKey); return; }
    if (event.key === 'Escape') { clearEditorSelection(); renderEditorGraph(); return; }
  }
  if (modal.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || !game) return;
  if (referencePlayback) {
    if (event.key === 'Escape') { event.preventDefault(); endReference(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); stepReference(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); stepReference(-1); }
    return;
  }
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); historyAction(event.shiftKey ? 'redo' : 'undo'); }
  else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === 'z' || key === 'x' || key === 'r') { event.preventDefault(); historyAction(key === 'z' ? 'undo' : key === 'x' ? 'redo' : 'reset'); }
  }
});
renderRoute();
