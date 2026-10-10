import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import * as RealThree from '../dist/vendor/three.module.min.js';
import * as Simulation from '../dist/simulation.js';

// Exercise business behavior and construct real Three.js geometry without a browser.
// This does not replace visual browser QA or verify GPU rendering.
const root = new URL('../', import.meta.url);
const html=readFileSync(new URL('dist/index.html',root),'utf8');
const source=readFileSync(new URL('dist/app.js',root),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'HTML IDs must be unique');
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
  if(match[1].startsWith('http')||match[1]==='./')continue;
  assert.ok(existsSync(new URL('dist/'+match[1].split('?')[0],root)),`Missing asset: ${match[1]}`);
}
const nodes=new Map();
function element(){return {innerHTML:'',textContent:'',value:'',checked:true,hidden:true,style:{},dataset:{},clientWidth:1364,clientHeight:922,children:[],classList:{add(){},remove(){},toggle(){}},append(e){this.children.push(e);},appendChild(e){this.children.push(e);},remove(){},setAttribute(){},addEventListener(type,fn){this['on'+type]=fn;},getBoundingClientRect(){return {left:0,top:0,width:1364,height:922,right:1364,bottom:922};},getContext(){return {fillRect(){},fillText(){}};},showModal(){this.open=true;},close(){this.open=false;}};}
const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},querySelectorAll(){return [];},createElement(){return element();},addEventListener(){},activeElement:{tagName:'BODY'}};
class Renderer{constructor(){this.domElement=element();this.shadowMap={};}setSize(){}setPixelRatio(){}render(){}}
class Controls{constructor(){this.target=new RealThree.Vector3();}update(){}}
let milliseconds=0;
const context=vm.createContext({console,document,...Simulation,THREE:{...RealThree,WebGLRenderer:Renderer},OrbitControls:Controls,performance:{now:()=>milliseconds},requestAnimationFrame(){},ResizeObserver:class{observe(){}},devicePixelRatio:1,innerWidth:1440,setInterval(){},setTimeout(){},clearTimeout(){}});
vm.runInContext(source.replace(/^import .*;\n/gm,'')+'\nglobalThis.app={get vehicles(){return vehicles;},get scene(){return scene;},get camera(){return camera;},get selected(){return selected;},get simulation(){return simulation;},get doors(){return dockMeshes;},get ready(){return sceneReady;},get running(){return running;},get meshes(){return truckMeshes;},selectVehicle,setTab,animate,resetSimulation};',context);
const {app}=context;
assert.ok(app.ready,'3D scene must construct successfully');
assert.equal(app.meshes.length,3);
assert.equal(app.selected.id,'TRK-2603');
let geometryCount=0;app.scene.traverse(o=>{if(o.isMesh){geometryCount++;const a=o.geometry.attributes.position;for(let i=0;i<a.array.length;i++)assert.ok(Number.isFinite(a.array[i]),'Geometry positions must be finite');}});
assert.ok(geometryCount>300,'Detailed scene must contain buildings and logistics assets');
app.selectVehicle('TRK-2148');assert.match(nodes.get('#detail-card').innerHTML,/沪 D·2148/);assert.match(nodes.get('#timeline').innerHTML,/已到达/);
app.selectVehicle('TRK-2603');
app.setTab('docks');assert.match(nodes.get('#asset-list').innerHTML,/已预约/);
assert.ok(app.running,'Fleet simulation must start automatically');
const start=app.meshes.map(m=>m.position.z);
for(let i=0;i<30;i++){milliseconds+=100;app.animate();}
assert.notEqual(app.meshes[0].position.z,start[0]);assert.notEqual(app.meshes[2].position.z,start[2]);
nodes.get('#simulation-toggle').onclick();assert.equal(app.running,false);
const paused=app.simulation.fleet.map(v=>[v.z,v.door.open,v.wheelAngle]);
milliseconds+=100;app.animate();assert.deepEqual(app.simulation.fleet.map(v=>[v.z,v.door.open,v.wheelAngle]),paused,'Pause must freeze every vehicle, door and wheel');
nodes.get('#speed-button').onclick();nodes.get('#speed-button').onclick();assert.equal(nodes.get('#speed-button').textContent,'4×');
nodes.get('#simulation-toggle').onclick();assert.ok(app.running);
for(let i=0;i<100;i++){milliseconds+=100;app.animate();}
assert.ok(app.running,'The fleet must keep cycling after arrival');
assert.ok(app.simulation.fleet.every(v=>v.cycles>=1));
app.resetSimulation();assert.equal(app.simulation.elapsed,0);assert.ok(app.running);assert.equal(app.meshes[2].position.z,15);assert.equal(app.vehicles[2].status,'驶入月台');
assert.equal(app.doors.get(3).shutter.scale.y,1);assert.equal(app.doors.get(1).shutter.scale.y,.015);

// Run multiple complete cycles and check interlocks on every physics step.
const sim=Simulation.createSimulation(app.vehicles);
const observed=new Map(sim.fleet.map(v=>[v.id,{phases:new Set(),open:false,closed:false,min:v.z,max:v.z}]));
for(let i=0;i<2400;i++){
  Simulation.stepSimulation(sim,.05);
  for(const v of sim.fleet){
    const seen=observed.get(v.id);seen.phases.add(v.phase);seen.open ||= v.door.open>=.999;seen.closed ||= v.door.open<=.001;seen.min=Math.min(seen.min,v.z);seen.max=Math.max(seen.max,v.z);
    assert.ok(v.z>=Simulation.DOCK_Z&&v.z<=Simulation.YARD_Z);
    if(v.phase==='unloading'||(v.phase==='docking'&&v.z<Simulation.WAIT_Z))assert.ok(v.door.open>=.999,'Vehicles must not dock or unload through a closed door');
    if(v.phase==='departing'&&v.z<Simulation.SENSOR_Z)assert.equal(v.door.open,1,'Door must stay open while its vehicle occupies the sensor zone');
    assert.ok(Number.isFinite(v.z)&&Number.isFinite(v.wheelAngle));
  }
}
for(const seen of observed.values()){assert.equal(seen.phases.size,6);assert.ok(seen.open&&seen.closed);assert.ok(seen.max-seen.min>20);}
const interlock=Simulation.createSimulation(app.vehicles),waiting=interlock.fleet[2];waiting.phase='waiting';waiting.z=Simulation.WAIT_Z;waiting.door.open=0;
Simulation.stepSimulation(interlock,.1);assert.equal(waiting.phase,'waiting');assert.equal(waiting.z,Simulation.WAIT_Z);assert.ok(waiting.door.open<1);
Simulation.stepSimulation(interlock,3);assert.equal(waiting.phase,'docking');assert.equal(waiting.door.open,1);
const independent=Simulation.createSimulation(app.vehicles);Simulation.stepSimulation(independent,.1);assert.equal(independent.fleet[1].door.open,1);assert.equal(independent.fleet[2].door.open,0,'Each dock must respond only to its assigned vehicle');
const closing=Simulation.createSimulation(app.vehicles),departing=closing.fleet[0];departing.phase='departing';departing.z=Simulation.SENSOR_Z+.1;departing.door.clearTime=0;
Simulation.stepSimulation(closing,1.4);assert.equal(departing.door.open,1,'Door must allow a delay after the vehicle clears the sensor');Simulation.stepSimulation(closing,1);assert.ok(departing.door.open<1);
nodes.get('#search').oninput({target:{value:'SHP-78472'}});assert.match(nodes.get('#search-results').innerHTML,/TRK-2603/);
nodes.get('#search').oninput({target:{value:'不存在的资产'}});assert.match(nodes.get('#search-results').innerHTML,/未找到匹配资产/);
nodes.get('#shipment-card').onclick();assert.ok(nodes.get('#info-dialog').open);assert.match(nodes.get('#dialog-content').innerHTML,/−18.2°C/);
nodes.get('#show-route').onchange({target:{checked:false}});nodes.get('#show-trees').onchange({target:{checked:false}});
const initialZoom=app.camera.zoom;nodes.get('#zoom-in').onclick();assert.ok(app.camera.zoom>initialZoom);nodes.get('#reset-view').onclick();assert.equal(app.camera.zoom,1.4);
console.log(JSON.stringify({passed:true,geometryCount,checks:['local asset references','unique HTML IDs','3D geometry construction','vehicle selection','4× simulation','pause/resume','three-vehicle continuous cycles','door safety interlock','independent door sensors','delayed door closure','shutter geometry synchronization','simulation reset','asset search','shipment details','layer visibility','camera controls'],limits:'No GPU rendering or visual browser verification.'},null,2));
