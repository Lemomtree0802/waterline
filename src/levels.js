// Official puzzle definitions for the public distribution.
import { importedLevels } from './imported-levels.js';
export const officialLevels = [
  {"id":"intro","name":"第1关","version":1,"source":"official","number":1,"w":["0","8"],"t":0,"e":[[0,1]],"pos":[[245,265],[555,265]]},
  {"id":"bridge","name":"第2关","version":1,"source":"official","number":2,"w":["0","0","9"],"t":0,"e":[[0,1],[1,2]],"pos":[[150,270],[400,270],[650,270]]},
  {"id":"restraint","name":"第3关","version":2,"source":"official","number":3,"w":["0","6","0"],"t":2,"e":[[0,1],[1,2]],"pos":[[150,270],[400,270],[650,270]]},
  {"id":"p1","name":"第4关","version":1,"source":"official","number":4,"w":["1","0","1"],"t":1,"e":[[0,1],[1,2]],"pos":[[150,270],[400,270],[650,270]]},
  {"id":"p2","name":"第5关","version":1,"source":"official","number":5,"w":["4","4","4","0","15"],"t":2,"e":[[0,1],[1,2],[2,3],[3,4]],"pos":[[100,270],[250,270],[400,270],[550,270],[700,270]]},
  {"id":"relay","name":"第6关","version":2,"source":"official","number":6,"w":["1","1","4","0","15"],"t":2,"e":[[0,1],[1,2],[2,3],[3,4]],"pos":[[100,270],[250,270],[400,270],[550,270],[700,270]]},
  ...importedLevels
];
