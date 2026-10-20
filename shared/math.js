// Shared scalar/vector helpers; no match-state dependencies.
export const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
export const length = (x,z) => Math.hypot(x,z);
export const distance = (a,b) => length(a.x-b.x,a.z-b.z);
export const normal = (x,z) => { const n=length(x,z); return n>0.0001?[x/n,z/n]:[0,0]; };
export const angleDiff = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
