import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneTransitions, createSceneTransitions } from '../src/scene.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = overrides => {
  const events = [];
  const scene = new SceneTransitions({lock: () => events.push('lock'), unlock: () => events.push('unlock'),
    cover: async () => events.push('cover'), reveal: async () => events.push('reveal'), ...overrides});
  return {scene, events};
};

test('the next scene waits for cover and data, and stays locked until entry ends', async () => {
  const fade = deferred(), data = deferred(), entry = deferred();
  const {scene, events} = fixture({cover: () => fade.promise, reveal: () => entry.promise});
  const next = scene.run({prepare: () => data.promise, mount: () => events.push('mount')});
  await tick(); assert.deepEqual(events, ['lock']);
  fade.resolve(); await tick(); assert.equal(events.includes('mount'), false);
  data.resolve(); await tick(); assert.deepEqual(events, ['lock','mount']);
  entry.resolve(); assert.equal(await next, true); assert.deepEqual(events, ['lock','mount','unlock']);
});

test('rapid navigation prepares serially and only the last queued destination mounts', async () => {
  const data = deferred(), mounted = [], errors = [];
  const {scene, events} = fixture();
  const first = scene.run({prepare: () => data.promise, mount: () => mounted.push('old'), onError: e => errors.push(e)});
  await tick();
  const middle = scene.run({mount: () => mounted.push('middle')});
  const latest = scene.run({mount: () => mounted.push('latest')});
  data.resolve();
  assert.equal(await first, false); assert.equal(await middle, false); assert.equal(await latest, true);
  assert.deepEqual(mounted, ['latest']); assert.deepEqual(errors, []);
  assert.equal(events.filter(e => e === 'lock').length, 1);
  assert.equal(events.filter(e => e === 'unlock').length, 1);
});

test('failed preparation restores input and lets the player retry without mounting a broken scene', async () => {
  const {scene, events} = fixture(); let reported;
  const result = await scene.run({prepare: () => { throw Error('offline'); }, mount: () => events.push('wrong'), onError: e => { reported = e.message; }});
  assert.equal(result, false); assert.equal(reported, 'offline'); assert.equal(scene.busy, false);
  assert.equal(events.includes('wrong'), false); assert.equal(events.at(-1), 'unlock');
  assert.equal(await scene.run({mount: () => events.push('retry')}), true);
  assert.ok(events.includes('retry'));
});

test('navigation during entry does not mark the superseded scene ready', async () => {
  const entry = deferred(), mounted = [];
  let reveals = 0;
  const {scene} = fixture({reveal: () => ++reveals === 1 ? entry.promise : Promise.resolve()});
  const first = scene.run({mount: () => mounted.push('first')}); await tick();
  const latest = scene.run({mount: () => mounted.push('latest')}); entry.resolve();
  assert.equal(await first, false); assert.equal(await latest, true);
  assert.deepEqual(mounted, ['first','latest']); assert.equal(scene.busy, false);
});

test('reduced motion skips animations and restores interaction and curtain state', async () => {
  const element = () => ({inert:false, attrs:new Map(), setAttribute(k,v) {this.attrs.set(k,v);}, removeAttribute(k) {this.attrs.delete(k);},
    animate() {throw Error('Motion should be skipped');}});
  const main=element(), header=element(), footer=element(), curtain={...element(),hidden:true,style:{}}, body={dataset:{}};
  const scene=createSceneTransitions({main,header,footer,curtain,body,reduced:()=>true});
  assert.equal(await scene.run({mount: () => assert.equal(main.inert,true)}),true);
  assert.equal(main.inert,false); assert.equal(header.inert,false); assert.equal(footer.inert,false);
  assert.equal(curtain.hidden,true); assert.equal(main.attrs.has('aria-busy'),false);
});
