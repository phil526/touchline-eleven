# Internal implementation contract

ES modules. World x length [-52.5,52.5], z width [-34,34], y height. Team 0 attacks +x in half 1. createMatch(options), stepMatch(state, inputs=[null,null], dt=1/60) from shared/simulation.js; mutate state. options: duration seconds (default 360), difficulty 'easy'|'standard', humans [true,false], tactics ['balanced','balanced']. Export TEAMS from shared/config.js, each {name,abbr,colour,secondary,players:[{name,number,role,attrs}]}. Fixed club/team index.

State JSON serialisable: tick,time (total active seconds),half (1/2),halfDuration,phase ('kickoff','playing','restart','goal','halftime','fulltime'), phaseTime,score [n,n],selected [id,id],players (22),ball, event {id,type,text}, restart (nullable), options. Players numeric id 0..21 (array index),team,slot,name,number,role,attrs,x,z,vx,vz,facing (atan2(vz,vx)),stamina 0..1,anim,actionTime,charge 0..1. Ball x,y,z,vx,vy,vz,owner null or numeric id,state,lastTouch numeric id or null. Extra fields permitted.

Input action: {mx,mz,sprint,jockey,pass,through,lob,shoot,tackle,switch}; mx/mz analogue [-1,1], shoot held boolean, other action buttons pulses each simulation tick or network message. Shared sim computes release and charge; export neutralInput(). Receiver intent may be state.players[id].receiver or state.receiver[team].

Renderer client/render.js exports createRenderer(canvas) returning {render(state, options),resize(),dispose(),stats()}; options {dt,team,quality:'low'|'medium'|'high',shadows,cameraHeight:0..1,reducedMotion,debug,menu}. No input dependencies; reads state only. Keep screen-right +x and screen-up -z. Optional target fields allowed.

Network agent owns server/*, client/network.js, tests/network.test.js, docs/NETWORK.md. Expose NetworkClient class with constructor({onRoom,onState,onStatus,onError}), connect(url), create(settings), join(code), ready(bool), settings(settings), input(actions), rematch(), leave(), disconnect(); team,room,latency,status and latest authoritative state accessible. Document exact protocol. create/join should wait until connection opens or callers await connect. Root will integrate.
