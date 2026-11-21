import test from 'node:test';
import assert from 'node:assert/strict';
import {officialLevels} from '../src/levels.js';
import {Engine as E} from '../src/engine.js';
import {fixedScale,fillRatio} from '../src/game.js';
import {positionsFor,playLayout,valvePositions} from '../src/graph.js';
import {compactWater} from '../src/water-text.js';

test('the public catalog has contiguous display numbers and unique level keys', () => {
  assert.equal(officialLevels.length,349);
  assert.equal(new Set(officialLevels.map(p=>p.id+'@'+p.version)).size,officialLevels.length);
  for(const [i,p] of officialLevels.entries()) {
    assert.equal(p.number,i+1);
    assert.equal(p.name,`第${i+1}关`);
    assert.equal(p.source,'official');
    assert.deepEqual(E.validateOfficial(p).e,p.e);
    assert.deepEqual(Object.keys(p).sort(),['e','id','name','number','pos','source','t','version','w']);
  }
});

test('catalog layouts and water fills stay finite on desktop and phone', () => {
  for(const p of officialLevels) {
    const scale=fixedScale(p);
    for(const w of E.initial(p).w) {
      const ratio=fillRatio(w,scale);
      assert.ok(Number.isFinite(ratio)&&ratio>=0&&ratio<=1);
    }
    for(const width of [288,1200]) {
      const layout=playLayout(positionsFor(p),width,600);
      assert.ok(layout.width>=width&&Number.isFinite(layout.width)&&Number.isFinite(layout.height));
      assert.ok(valvePositions(p,layout.positions).flat().every(Number.isFinite));
    }
  }
});

test('large exact quantities respect the official and workshop input limits', () => {
  const w=['42'+'0'.repeat(109),...Array(11).fill('0')];
  const p={w,e:w.slice(1).map((_,i)=>[i,i+1]),t:0};
  const state=E.initial(E.validateOfficial(p));
  assert.equal(E.str(state.w[0]),w[0]);
  assert.equal(compactWater(state.w[0]),'4.2e110');
  assert.throws(()=>E.parse(w[0]));
  assert.throws(()=>E.validate(p),/2–10/);
  assert.throws(()=>E.parseExact('1/0'),/分母/);
});
