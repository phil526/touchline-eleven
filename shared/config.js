export const PITCH = Object.freeze({length:105,width:68,halfLength:52.5,halfWidth:34,goalWidth:7.32,goalHeight:2.44,boxLength:16.5,boxWidth:40.32,ballRadius:0.11});
export const FIXED_DT = 1 / 60;
export const FORMATION = [
  [-48,0],[-32,-24],[-35,-8],[-35,8],[-32,24],[-15,0],[-7,-15],[-7,15],[15,-24],[21,0],[15,24]
];
const base = {pace:73,acceleration:74,stamina:78,control:75,passing:75,shooting:69,tackling:68,goalkeeping:12};
function player(name,number,role,attrs={}) { return {name,number,role,attrs:{...base,...attrs}}; }
export const TEAMS = [
  {name:'Northstar Athletic',abbr:'NSA',colour:'#224cc7',secondary:'#f5f0dc',players:[
    player('Elias Ward',1,'GK',{pace:55,control:68,passing:69,shooting:32,tackling:40,goalkeeping:83}),
    player('Luca Vale',3,'LB',{pace:80,tackling:79}),player('Noah Mercer',4,'CB',{pace:64,tackling:84,shooting:49}),
    player('Dara Cole',5,'CB',{pace:67,tackling:82,shooting:51}),player('Rafi Stone',2,'RB',{pace:81,tackling:77}),
    player('Milo Hart',6,'DM',{passing:82,tackling:81,pace:69}),player('Theo Quinn',8,'CM',{control:83,passing:84,shooting:75}),
    player('Sami Reed',10,'CM',{control:84,passing:83,shooting:78}),player('Jude Rowan',11,'LW',{pace:86,control:83,shooting:78}),
    player('Alex Sol',9,'ST',{pace:79,shooting:86,control:81,tackling:44}),player('Ivo Lane',7,'RW',{pace:85,control:82,shooting:80})
  ]},
  {name:'Ember Borough',abbr:'EMB',colour:'#f39d32',secondary:'#252b32',players:[
    player('Jonas Flint',1,'GK',{pace:56,control:68,passing:71,shooting:33,tackling:41,goalkeeping:82}),
    player('Nico Ash',3,'LB',{pace:81,tackling:77}),player('Amir Brook',4,'CB',{pace:68,tackling:82,shooting:50}),
    player('Finn Calder',5,'CB',{pace:65,tackling:84,shooting:52}),player('Leo Banks',2,'RB',{pace:80,tackling:79}),
    player('Owen Moss',6,'DM',{passing:79,tackling:83,pace:70}),player('Kian Blake',8,'CM',{control:80,passing:82,shooting:78}),
    player('Remy Frost',10,'CM',{control:83,passing:81,shooting:79}),player('Zaki West',11,'LW',{pace:84,control:81,shooting:80}),
    player('Max Alder',9,'ST',{pace:81,shooting:85,control:80,tackling:45}),player('Evan Pike',7,'RW',{pace:86,control:82,shooting:77})
  ]}
];
