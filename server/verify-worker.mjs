import { parentPort } from 'node:worker_threads';
import { Engine as E } from '../src/engine.js';
import { rankRecords, leaderboardForViewer } from '../src/ranking.js';
import { goalScore, fraction as parseFraction } from '../src/game.js';

const fraction = value => { const [n, d = '1'] = value.split('/'); return { n: BigInt(n), d: BigInt(d) }; };
const compare = (a, b) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
parentPort.on('message', ({ id, mode, payload }) => {
  try {
    let result;
    if (mode === 'ai-step') {
      const state={w:payload.state.water.map(parseFraction),mask:payload.state.mask};
      const next=E.move(payload.puzzle,state,payload.edge);
      result={water:next.w.map(E.str),mask:next.mask};
    } else if (mode === 'ai-ranking') {
      const ranked=rankRecords(payload.records),score=parseFraction(payload.score);
      const higher=new Set(ranked.filter(r=>r.playerId!==payload.playerId&&E.cmp(parseFraction(r.score),score)>0).map(r=>r.score));
      result={submittedRank:higher.size+1,board:leaderboardForViewer(ranked,payload.playerId)};
    } else if (mode === 'rank') {
      result = rankRecords(payload);
    } else if (mode === 'compare') result = compare(fraction(payload.a), fraction(payload.b));
    else {
      let puzzle = payload.puzzle, moves = payload.moves;
      if (!Array.isArray(moves)) throw Error('操作序列必须是数组');
      if (mode === 'publish') {
        const original = puzzle;
        puzzle = E.validate(original);
        moves = moves.map(k => {
          if (!Number.isInteger(k) || k < 0 || k >= original.e.length) throw Error('无效阀门');
          const pair = original.e[k].slice().sort((a, b) => a - b);
          return puzzle.e.findIndex(e => e[0] === pair[0] && e[1] === pair[1]);
        });
      }
      // Server verification keeps only the current state, rather than every undo frame.
      let state = E.initial(puzzle);
      const goal = mode === 'publish' ? null : goalScore(puzzle);
      let completionIndex = goal && E.cmp(state.w[puzzle.t], goal) >= 0 ? 0 : -1;
      for (let i = 0; i < moves.length; i++) {
        state = E.move(puzzle, state, moves[i]);
        if (completionIndex < 0 && goal && E.cmp(state.w[puzzle.t], goal) >= 0) completionIndex = i + 1;
      }
      const score = E.str(state.w[puzzle.t]);
      result = { score, moves, puzzle, completionMoves: completionIndex < 0 ? null : moves.slice(0, completionIndex) };
    }
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
