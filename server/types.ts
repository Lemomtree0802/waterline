export type Player = { id: string; username: string; name: string };
export type Puzzle = { id: string; version: number; name: string; description?: string; source: string; w: string[]; e: number[][]; t: number; pos?: number[][]; [key: string]: unknown };
export type RecordRow = { id: string; playerId: string; playerName: string; playerUsername?: string; score: string; achievedAt: number; moves?: number[]; rank?: number };
export class ApiError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) { super(message); }
}
