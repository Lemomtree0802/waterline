import {Engine as E} from './engine.js';

// Keep very large water amounts readable without converting exact state to floats.
export function compactWater(value) {
  const whole=value.n/value.d;
  if(whole.toString().length<=9)return E.dec(value,3);
  const exponent=whole.toString().length-1;
  return `${E.dec(E.F(value.n,value.d*10n**BigInt(exponent)),3)}e${exponent}`;
}
