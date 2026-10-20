import {predictKeeperBall} from '../shared/goalkeeping.js';

// Cosmetic anticipation follows a released shot, never a held aiming target.
// Actual saves still require the authoritative swept ball/keeper contact.
export function keeperDiveCue(state,player) {
  const ball=state?.ball,shot=ball?.lastShot;
  if(player.penaltyDive){const d=player.penaltyDive;if(d.age<0||d.age>1.1)return null;return {point:{x:player.x+Math.cos(player.facing)*.25,y:1,z:player.z+d.worldSide*.8},facing:player.facing,weight:Math.min(1,d.age/.12)*Math.max(0,1-(d.age-.65)/.45)};}
  if(state?.phase!=='playing'||!shot||shot.team===player.team||ball.owner!==null||state.tick-shot.tick<5||state.tick-shot.tick>120||Math.abs(ball.vx)<5)return null;
  const time=(player.x-ball.x)/ball.vx;
  if(time<0||time>.38)return null;
  const point=predictKeeperBall(ball,time);
  if(Math.abs(point.z-player.z)>2.2||point.y>2.8)return null;
  return {point,facing:Math.atan2(-ball.vz,-ball.vx),weight:Math.min(1,(.38-time)/.2)};
}
