export const POSSESSION_BURST_DURATION=1.5;
export const POSSESSION_BURST_MULTIPLIER=1.3;
const roles=new Set(['DM','CM','AM','LM','RM','LW','RW','ST','CF']);
export const receivesPossessionBurst=player=>roles.has(player.role);

export function finishPossessionBurst(state,previousOwner,wasPlaying){
  for(const player of state.players){
    if(state.phase!=='playing'||state.ball.owner!==player.id||state.ball.state==='held'||!receivesPossessionBurst(player))player.possessionBurst=0;
    else if(wasPlaying&&previousOwner!==player.id)player.possessionBurst=POSSESSION_BURST_DURATION;
  }
}
