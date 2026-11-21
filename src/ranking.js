import { Engine as E } from './engine.js';
import { fraction } from './game.js';

// Timestamps stabilize stored records but never separate equal-water ranks.
export const compareRecords = (a, b) => E.cmp(fraction(b.score), fraction(a.score)) || a.achievedAt - b.achievedAt || a.id.localeCompare(b.id);

export function rankRecords(records) {
  let rank = 0, previous = null;
  const values = records.map(record => ({record, score: fraction(record.score)}));
  values.sort((a, b) => E.cmp(b.score, a.score) || a.record.achievedAt - b.record.achievedAt || a.record.id.localeCompare(b.record.id));
  return values.map(({record, score}) => {
    if (previous === null || E.cmp(score, previous) !== 0) rank++;
    previous = score;
    return { ...record, rank };
  });
}

// Only the viewer's submitted best unlocks the table. Higher scores never leave
// the server, including on later pages or through a different player's profile.
export function leaderboardForViewer(records, viewerId, offset = 0, limit = 25) {
  const mine = records.find(row => row.playerId === viewerId) || null;
  return {
    rank: mine?.rank ?? null, mine, total: records.length, unlocked: Boolean(mine), offset, limit,
    records: mine ? records.slice(offset, offset + limit).map(row => ({
      rank: row.rank, playerId: row.playerUsername || row.playerName || row.playerId,
      score: row.rank < mine.rank ? null : row.score, hidden: row.rank < mine.rank,
      isMine: row.playerId === viewerId,
    })) : [],
  };
}
