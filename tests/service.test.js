import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalService, levelKey, compareRecords, readPuzzleFile } from '../src/service.js';
import { officialLevels } from '../src/levels.js';
import { rankRecords } from '../src/ranking.js';

function fixture() {
  const data = new Map(); let time = 1000, id = 0;
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const service = new LocalService({ storage, now: () => time, uuid: () => String(++id) });
  return { service, storage, tick: next => { time = next; } };
}
const p = officialLevels.find(p => p.id === 'p1'), key = levelKey(p);

test('higher exact water ranks first, even when achieved later', () => {
  const records = [{ id: 'a', score: '2/3', achievedAt: 1 }, { id: 'b', score: '3/4', achievedAt: 999 }].sort(compareRecords);
  assert.equal(records[0].id, 'b');
  assert.equal(compareRecords({ id:'a', score:'1000000000000000000000001/1000000000000000000000000', achievedAt:9 }, { id:'b', score:'1', achievedAt:1 }), -1);
});
test('equal-water records retain stable internal order, independently of step count', () => {
  const a = { id: 'a', score: '3/4', achievedAt: 2000, moves: [0, 0, 1] };
  const b = { id: 'b', score: '3/4', achievedAt: 1000, moves: [0, 0, 1, 1, 1] };
  assert.deepEqual([a, b].sort(compareRecords).map(r => r.id), ['b', 'a']);
});

test('equal exact water shares a dense rank, including equivalent fractions and beyond 100 scores', () => {
  const ranked = rankRecords([
    {id:'a',score:'4',achievedAt:2}, {id:'b',score:'4',achievedAt:1},
    {id:'c',score:'2/3',achievedAt:3}, {id:'d',score:'4/6',achievedAt:4},
    {id:'e',score:'1/2',achievedAt:0},
  ]);
  assert.deepEqual(ranked.map(r => r.rank), [1,1,2,2,3]);
  const many = Array.from({length:120}, (_, i) => ({id:String(i),score:`${i}/121`,achievedAt:0}));
  assert.equal(rankRecords(many).at(-1).rank, 120);
});

test('local players share a rank for equal water and the next distinct score follows immediately', async () => {
  const {service}=fixture(); const a=service.createProfile('A');
  assert.equal((await service.submitRun({key,moves:[0,0,1]})).rank,1);
  service.createProfile('B'); assert.equal((await service.submitRun({key,moves:[0,0,1]})).rank,1);
  service.createProfile('C'); assert.equal((await service.submitRun({key,moves:[0]})).rank,2);
  service.switchProfile(a.id); assert.equal(service.getRank(key),1);
});
test('same or worse score retains first timestamp; improvement records new timestamp', async () => {
  const { service, tick } = fixture(); const alice = service.createProfile('Alice');
  const first = await service.submitRun({ key, moves: [0] });
  assert.equal(first.record.score, '1/2'); assert.equal(first.record.achievedAt, 1000);
  assert.deepEqual(service.getProgress(p), []);
  tick(2000); const repeat = await service.submitRun({ key, moves: [0, 0] });
  assert.equal(repeat.improved, false); assert.equal(repeat.record.achievedAt, 1000);
  const worse = await service.submitRun({ key, moves: [] }); assert.equal(worse.record.score, '1/2');
  tick(3000); const improved = await service.submitRun({ key, moves: [0, 0, 1] });
  assert.equal(improved.record.score, '3/4'); assert.equal(improved.record.achievedAt, 3000);
  tick(4000); const bob = service.createProfile('Bob');
  await service.submitRun({ key, moves: [0, 0, 1, 1, 1] });
  assert.deepEqual(service.getLeaderboard(key).map(r => r.playerId), [alice.name, bob.name]);
  assert.equal(service.getLeaderboard(key).length, 2);
});
test('submission computes score from puzzle and moves, not caller supplied score or timestamp', async () => {
  const { service } = fixture(); service.createProfile('Alice');
  const r = await service.submitRun({ key, moves: [0], score: '9999', achievedAt: 1 });
  assert.equal(r.record.score, '1/2'); assert.equal(r.record.achievedAt, 1000);
});
test('publishing assigns an author sequence without submitting a score or retaining a solution', async()=>{
  const {service}=fixture();service.createProfile('Alice');
  const raw={...p,pos:[[100,240],[400,240],[700,240]],description:'留言'};
  const first=await service.publishLevel(raw,[0,0,1]),second=await service.publishLevel(raw,[]);
  assert.equal(first.name,'Alice-1');assert.equal(second.name,'Alice-2');
  assert.equal(first.authorScore,undefined);assert.equal(first.referenceMoves,undefined);
  assert.equal(service.getMyRecord(levelKey(first)),null);
  assert.equal(service.getSubmissionCount(levelKey(first)),0);
  assert.deepEqual(service.getProgress(first),[]);
});

test('only explicit submissions persist the best exact score and its original replay',async()=>{
  const {service,storage,tick}=fixture();const alice=service.createProfile('Alice');
  service.saveProgress(p,[0,0,1]);assert.deepEqual(service.getProgress(p),[]);
  const first=await service.submitRun({key,moves:[0,0,1]});
  tick(2000);await service.submitRun({key,moves:[]});await service.submitRun({key,moves:[0,0,1,1,1]});
  const restored=new LocalService({storage});
  assert.deepEqual(restored.getMyRecord(key).moves,[0,0,1]);
  assert.equal(restored.getMyRecord(key).achievedAt,first.record.achievedAt);
  assert.deepEqual(restored.getProgress(p),[]);assert.equal(restored.getCompletion(p),null);
  restored.createProfile('Bob');assert.equal(restored.getMyRecord(key),null);
  restored.switchProfile(alice.id);assert.equal(restored.getRank(key),1);
});

test('number format reminders and onboarding preferences survive reloading', () => {
  const { service, storage } = fixture();
  assert.equal(service.getPreferences().numberFormatHintSeen, false);
  service.setPreferences({ decimal: true, numberFormatHintSeen: true, tutorialSeen: true, explorationHintSeen: true });
  const restored = new LocalService({ storage });
  assert.deepEqual(restored.getPreferences(), { decimal: true, numberFormatHintSeen: true, tutorialSeen: true, explorationHintSeen: true });
});
test('storage failure falls back to usable in-memory play', async () => {
  let warned = false;
  const service = new LocalService({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } }, uuid: () => 'user', now: () => 1, onStorageError: () => { warned = true; } });
  service.createProfile('Alice'); assert.equal(service.getProfile().name, 'Alice');
  assert.equal((await service.submitRun({ key, moves: [0] })).record.score, '1/2'); assert.equal(warned, true);
});
test('import validates graph and rejects malicious or invalid coordinate data', () => {
  const imported = readPuzzleFile(JSON.stringify({ puzzle: { ...p, pos: [[0, 900], [1, 1], [2, 2]] } }));
  assert.deepEqual(imported.pos[0], [65, 405]);
  assert.throws(() => readPuzzleFile('{invalid'));
  assert.throws(() => readPuzzleFile(JSON.stringify({ w: ['-1', '0'], t:0, e:[[0,1]] })));
});
test('author deletion keeps numbering unique and records recoverable in storage',async()=>{
  const {service,storage}=fixture();const alice=service.createProfile('Alice');
  const level=await service.publishLevel(p,[]),ownKey=levelKey(level);
  await service.submitRun({key:ownKey,moves:[0]});
  service.createProfile('Bob');await assert.rejects(service.deleteLevel(ownKey),/自己发布/);
  service.switchProfile(null);await assert.rejects(service.deleteLevel(ownKey),/登录/);
  service.switchProfile(alice.id);await assert.rejects(service.deleteLevel(key),/自己发布/);
  await service.deleteLevel(ownKey);assert.equal(service.getLevel(ownKey),null);
  const next=await service.publishLevel(p,[]);assert.equal(next.name,'Alice-2');
  assert.equal(JSON.parse(storage.getItem('waterline-app-v1')).records[ownKey].length,1);
});

test('player lookup exposes submitted levels and masks a stronger player score',async()=>{
  const {service}=fixture();const alice=service.createProfile('Alice');await service.submitRun({key,moves:[0,0,1]});
  await service.publishLevel(p,[]);service.createProfile('Bob');await service.submitRun({key,moves:[0]});
  assert.equal((await service.searchPlayers('Ali'))[0].username,'Alice');
  const profile=await service.getPlayerProfile('Alice');assert.equal(profile.levels[0].name,'Alice-1');
  assert.equal(profile.records[0].score,null);service.switchProfile(alice.id);
  assert.equal((await service.getPlayerProfile('Alice')).records[0].score,'3/4');
});
