import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRecords, leaderboardForViewer } from '../src/ranking.js';
import { officialLevels } from '../src/levels.js';
import { wordmarkNetwork, toggleWordmark } from '../src/home-wordmark.js';
import { Engine as E } from '../src/engine.js';

test('higher ranks hide exact and decimal scores while ties and lower scores remain visible',()=>{
  const records=rankRecords([
    {id:'early',playerId:'a',playerUsername:'first_player',score:'65/32',achievedAt:1,moves:[9]},
    {id:'later',playerId:'b',playerUsername:'second_player',score:'130/64',achievedAt:2,moves:[5]},
    {id:'viewer',playerId:'c',playerUsername:'viewer',score:'2',achievedAt:3,moves:[2]},
    {id:'tie',playerId:'d',playerUsername:'same_score',score:'4/2',achievedAt:4},
    {id:'lower',playerId:'e',playerUsername:'lower_score',score:'9/5',achievedAt:5},
  ]);
  const board=leaderboardForViewer(records,'c');
  assert.deepEqual(board.records.map(row=>row.rank),[1,1,2,2,3]);
  assert.deepEqual(board.records.map(row=>row.score),[null,null,'2','4/2','9/5']);
  assert.deepEqual(board.records.map(row=>row.playerId),['first_player','second_player','viewer','same_score','lower_score']);
  assert.equal(board.mine.score,'2');assert.equal(board.rank,2);
  assert.equal(JSON.stringify(board).includes('65/32'),false);
  assert.equal(JSON.stringify(board.records).includes('moves'),false);
  assert.equal(board.records[2].isMine,true);
  assert.deepEqual(leaderboardForViewer(records,undefined).records,[]);
  assert.deepEqual(leaderboardForViewer(records,'never_submitted').records,[]);
  assert.deepEqual(leaderboardForViewer(records,'c',1,2).records.map(row=>row.score),[null,'2']);
});

test('public puzzle definitions reveal neither thresholds nor reference solutions',()=>{
  assert.equal(officialLevels.length,157);
  for(const level of officialLevels) {
    for(const field of ['goalWater','optimalWater','plan','score','referenceMoves','lesson','clue'])assert.equal(level[field],undefined);
    assert.equal(E.validateOfficial(level).w.length,level.w.length);
  }
});

test('playable WATERLINE uses green randomized water and conserves exact total across all valves',()=>{
  let i=0;const network=wordmarkNetwork(()=>((i++%9)+.1)/9);
  assert.ok(network.nodes.length>30);assert.ok(network.edges.length>31);
  assert.equal(new Set(network.nodes.map(node=>node.letter)).size,9);
  const total=()=>E.str(E.sum(network.nodes.map(node=>node.water))),initial=total();
  for(let pass=0;pass<3;pass++)for(let edge=0;edge<network.edges.length;edge++)toggleWordmark(network,edge);
  assert.equal(total(),initial);
  assert.notDeepEqual(wordmarkNetwork(()=>0).nodes.map(node=>E.str(node.water)),wordmarkNetwork(()=>.99).nodes.map(node=>E.str(node.water)));
});
