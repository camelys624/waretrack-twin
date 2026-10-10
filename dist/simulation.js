// One vehicle is assigned to each dock. Door and vehicle movement share this state.
export const DOCK_Z = -4.8;
export const WAIT_Z = 2.5;
export const SENSOR_Z = 5;
export const YARD_Z = 19;
export const PHASE_NAMES = {
  approach:'驶入月台', waiting:'等待开门', docking:'倒车停靠',
  unloading:'卸货中', departing:'驶离月台', standby:'园区待命'
};
export function createSimulation(vehicles) {
  return {
    elapsed:0,
    fleet:vehicles.map((v,index)=>({
      id:v.id,bay:v.bay,index,x:v.position[0],
      z:index<2?DOCK_Z:v.position[1],phase:index<2?'unloading':'approach',
      phaseTime:index===0?5.5:index===1?2:0,
      wheelAngle:0,velocity:0,cycles:0,arrived:index<2,
      door:{open:index<2?1:0,target:index<2?1:0,clearTime:0}
    })),events:[]
  };
}
export function doorStatus(door) {
  if(door.open>=.999)return '已开启';
  if(door.open<=.001)return '已关闭';
  return door.target?'开启中':'关闭中';
}
export function dockStatus(vehicle) {
  if(vehicle.phase==='unloading')return '作业中';
  if(vehicle.phase==='docking')return '停靠中';
  if(vehicle.phase==='waiting')return '开门中';
  if(vehicle.phase==='departing')return '驶离中';
  return vehicle.phase==='standby'?'空闲':'已预约';
}
function transition(sim,vehicle,phase) {
  vehicle.phase=phase;vehicle.phaseTime=0;
  if(phase==='unloading')vehicle.arrived=true;
  if(phase==='departing')vehicle.cycles++;
  if(phase==='approach')vehicle.arrived=false;
  sim.events.unshift({id:vehicle.id,bay:vehicle.bay,phase,time:sim.elapsed});
  sim.events.length=Math.min(sim.events.length,8);
}
export function stepSimulation(sim,seconds) {
  if(!Number.isFinite(seconds)||seconds<=0)return;
  // Substeps preserve the door interlock at high playback speeds and low frame rates.
  let remaining=seconds;
  while(remaining>1e-8){
    const dt=Math.min(.05,remaining);remaining-=dt;sim.elapsed+=dt;
    for(const v of sim.fleet){
      const before=v.z;v.phaseTime+=dt;
      const requested=(v.phase==='approach'&&v.z<=SENSOR_Z)
        ||['waiting','docking','unloading'].includes(v.phase)
        ||(v.phase==='departing'&&v.z<SENSOR_Z);
      v.door.clearTime=requested?0:v.door.clearTime+dt;
      if(requested)v.door.target=1;
      else if(v.door.clearTime>=1.5)v.door.target=0;
      const direction=v.door.target?1:-1;
      v.door.open=Math.max(0,Math.min(1,v.door.open+direction*dt/2.4));
      switch(v.phase){
        case 'approach':
          v.z=Math.max(WAIT_Z,v.z-dt*3.2);
          if(v.z<=WAIT_Z)transition(sim,v,'waiting');
          break;
        case 'waiting':
          if(v.door.open>=.999)transition(sim,v,'docking');
          break;
        case 'docking':
          // A closing/blocked door stops the vehicle immediately.
          if(v.door.open>=.999){v.z=Math.max(DOCK_Z,v.z-dt*2);if(v.z<=DOCK_Z)transition(sim,v,'unloading');}
          break;
        case 'unloading':
          if(v.phaseTime>=6+v.index*2)transition(sim,v,'departing');
          break;
        case 'departing':
          v.z=Math.min(YARD_Z,v.z+dt*3.4);
          if(v.z>=YARD_Z)transition(sim,v,'standby');
          break;
        case 'standby':
          if(v.phaseTime>=3+v.index*1.5&&v.door.open<=.001)transition(sim,v,'approach');
          break;
      }
      v.velocity=(v.z-before)/dt;v.wheelAngle+=(v.z-before)/.47;
    }
  }
}
