document.addEventListener("DOMContentLoaded", () => {

  // ---------- Utilities ----------
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function genColor(i, total){
    const hue = (i * 360/Math.max(total, 6)) % 360;
    return `hsl(${hue} 70% 60%)`;
  }

  function readProcesses(){
    const rows = $$('#ptable tbody tr');
    const seenPIDs = new Set();
    const procs = [];
    for(const tr of rows){
      const pid = tr.querySelector('.pid').value.trim();
      const at = Number(tr.querySelector('.at').value);
      const bt = Number(tr.querySelector('.bt').value);
      const pr = Number(tr.querySelector('.pr').value);
      const color = tr.querySelector('.color').value;
      if(!pid) throw new Error('PID missing in one of the rows.');
      if(seenPIDs.has(pid)) throw new Error(`Duplicate PID: ${pid}`);
      if(!(Number.isFinite(at) && at >= 0)) throw new Error(`Invalid arrival for ${pid}`);
      if(!(Number.isFinite(bt) && bt > 0)) throw new Error(`Invalid burst for ${pid}`);
      if(!Number.isFinite(pr)) throw new Error(`Invalid priority for ${pid}`);
      seenPIDs.add(pid);
      procs.push({ pid, arrival: at, burst: bt, priority: pr, color });
    }
    return procs.sort((a,b)=> a.arrival - b.arrival || a.pid.localeCompare(b.pid));
  }

  function renderLegend(procs){
    const leg = $('#legend');
    leg.innerHTML = '';
    for(const p of procs){
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="mini">${p.pid}</span>`;
      leg.appendChild(chip);
    }
    const idle = document.createElement('div');
    idle.className = 'chip';
    idle.innerHTML = `<span class="dot" style="background:var(--idle)"></span><span class="mini">Idle</span>`;
    leg.appendChild(idle);
  }

  function ticksFromBlocks(blocks){
    const pts = new Set([0]);
    for(const b of blocks){ pts.add(b.start); pts.add(b.end); }
    const arr = Array.from(pts).sort((a,b)=>a-b);
    return {origin: Math.min(...arr), ticks: arr};
  }

  function buildTicks(ticks, scale){
    const tb = $('#ticks'); tb.innerHTML = '';
    if(!ticks.ticks.length) return;
    for(let i=0;i<ticks.ticks.length;i++){
      const t = ticks.ticks[i];
      const w = (i===0)? 0 : (ticks.ticks[i]-ticks.ticks[i-1]) * scale;
      const div = document.createElement('div');
      div.className = 'tick';
      div.style.width = w + 'px';
      div.innerHTML = `<span class="tlabel">${t}</span>`;
      tb.appendChild(div);
    }
    const endCap = document.createElement('div');
    endCap.className = 'tick'; endCap.style.width = '0px';
    endCap.innerHTML = `<span class="tlabel">${ticks.ticks[ticks.ticks.length-1]}</span>`;
    tb.appendChild(endCap);
  }

  function renderGantt(blocks, scale){
    const g = $('#gantt'); g.innerHTML = '';
    for(const b of blocks){
      const div = document.createElement('div');
      div.className = 'block' + (b.pid==='IDLE'?' idle':'');
      div.style.width = ((b.end - b.start) * scale) + 'px';
      div.style.background = b.pid==='IDLE' ? '' : b.color;
      div.title = `${b.pid} : ${b.start} → ${b.end} (Δ ${b.end-b.start})`;
      div.textContent = b.pid==='IDLE' ? 'Idle' : b.pid;
      g.appendChild(div);
    }
    const tks = ticksFromBlocks(blocks);
    buildTicks(tks, scale);
  }

  function setError(msg){
    const e = $('#err'); e.textContent = msg || '';
  }
// ---------- Scheduling Algorithms ----------

// FCFS (First Come First Served)
function fcfs(processes){
  const res = new Map();
  const blocks = [];
  let time = Math.min(...processes.map(p=>p.arrival));
  let i = 0;
  while(i < processes.length){
    const p = processes[i];
    if(time < p.arrival){
      blocks.push({ pid:'IDLE', start: time, end: p.arrival, color: 'var(--idle)' });
      time = p.arrival;
    }
    const start = time;
    const end = time + p.burst;
    res.set(p.pid, { start, completion: end, tat: end - p.arrival, wt: start - p.arrival, response: start - p.arrival, arrival:p.arrival, burst:p.burst, priority:p.priority });
    blocks.push({ pid:p.pid, start, end, color:p.color });
    time = end;
    i++;
  }
  return { blocks, results: res, endTime: time };
}

// SJF (Shortest Job First) – Non-preemptive
function sjf(processes){
  const res = new Map();
  const blocks = [];
  const n = processes.length;
  let completed = 0; let time = Math.min(...processes.map(p=>p.arrival));
  const ready = [];
  const used = new Set();
  while(completed < n){
    for(let idx=0; idx<processes.length; idx++){
      const p = processes[idx];
      if(!used.has(idx) && p.arrival <= time){ ready.push(idx); used.add(idx); }
    }
    if(ready.length===0){
      const next = Math.min(...processes.filter((_,idx)=>!used.has(idx)).map(p=>p.arrival));
      if(Number.isFinite(next)){
        blocks.push({ pid:'IDLE', start: time, end: next, color:'var(--idle)'});
        time = next; continue;
      } else break;
    }
    ready.sort((ia, ib)=>{
      const a=processes[ia], b=processes[ib];
      return a.burst - b.burst || a.arrival - b.arrival || a.pid.localeCompare(b.pid);
    });
    const idx = ready.shift();
    const p = processes[idx];
    const start = time;
    const end = time + p.burst;
    blocks.push({ pid:p.pid, start, end, color:p.color });
    res.set(p.pid, { start, completion:end, tat:end-p.arrival, wt:start-p.arrival, response:start-p.arrival, arrival:p.arrival, burst:p.burst, priority:p.priority });
    time = end; completed++;
  }
  return { blocks, results: res, endTime: time };
}

// SRTF (Shortest Remaining Time First) – Preemptive
function srtf(processes){
  const n = processes.length; const res = new Map(); const blocks=[];
  const rem = processes.map(p=>p.burst);
  const started = new Array(n).fill(false);
  let time = Math.min(...processes.map(p=>p.arrival));
  let lastPID = null; let blockStart = time;
  const done = new Set();
  while(done.size < n){
    let best = -1; let bestRem = Infinity;
    for(let i=0;i<n;i++){
      const p = processes[i];
      if(done.has(i)) continue;
      if(p.arrival <= time && rem[i] > 0){
        if(rem[i] < bestRem || 
          (rem[i]===bestRem && (p.arrival - processes[best]?.arrival || 0) < 0) || 
          (rem[i]===bestRem && p.pid.localeCompare(processes[best]?.pid||'')<0)){
            best = i; bestRem = rem[i];
        }
      }
    }
    if(best === -1){
      if(lastPID !== 'IDLE'){
        if(lastPID!==null){
          blocks.push({ pid:lastPID, start:blockStart, end:time, color: lastPID==='IDLE'?'var(--idle)': processes.find(pp=>pp.pid===lastPID).color });
        }
        lastPID = 'IDLE'; blockStart = time;
      }
      time += 1;
      continue;
    }
    const p = processes[best];
    if(!started[best]){
      started[best] = true; 
      res.set(p.pid, { start: time, completion:0, tat:0, wt:0, response: time - p.arrival, arrival:p.arrival, burst:p.burst, priority:p.priority }); 
    }
    if(lastPID !== p.pid){
      if(lastPID!==null){
        blocks.push({ pid:lastPID, start:blockStart, end:time, color: lastPID==='IDLE'?'var(--idle)': processes.find(pp=>pp.pid===lastPID).color });
      }
      lastPID = p.pid; blockStart = time;
    }
    rem[best] -= 1; time += 1;
    if(rem[best] === 0){
      const completion = time;
      const r = res.get(p.pid);
      r.completion = completion;
      r.tat = completion - p.arrival;
      r.wt = r.tat - p.burst;
      res.set(p.pid, r);
      done.add(best);
    }
  }
  if(lastPID!==null){
    blocks.push({ pid:lastPID, start:blockStart, end:time, color: lastPID==='IDLE'?'var(--idle)': processes.find(pp=>pp.pid===lastPID)?.color || 'var(--idle)' });
  }
  const filtered = blocks.filter(b=>b.end>b.start);
  return { blocks: filtered, results: res, endTime: time };
}

// Priority Scheduling – Non-preemptive (Lower number = higher priority)
function prioritySchedule(processes){
  const res = new Map(); const blocks=[];
  const n = processes.length; let completed=0; let time = Math.min(...processes.map(p=>p.arrival));
  const added = new Set(); const ready=[];
  while(completed<n){
    for(let i=0;i<processes.length;i++){
      const p = processes[i]; if(!added.has(i) && p.arrival<=time){ ready.push(i); added.add(i); }
    }
    if(ready.length===0){
      const next = Math.min(...processes.filter((_,i)=>!added.has(i)).map(p=>p.arrival));
      if(Number.isFinite(next)) { blocks.push({ pid:'IDLE', start:time, end:next, color:'var(--idle)'}); time=next; continue; }
      else break;
    }
    ready.sort((ia,ib)=>{
      const a=processes[ia], b=processes[ib];
      return a.priority - b.priority || a.arrival - b.arrival || a.pid.localeCompare(b.pid);
    });
    const idx = ready.shift(); const p = processes[idx];
    const start=time; const end=time+p.burst; blocks.push({ pid:p.pid, start, end, color:p.color });
    res.set(p.pid,{ start, completion:end, tat:end-p.arrival, wt:start-p.arrival, response:start-p.arrival, arrival:p.arrival, burst:p.burst, priority:p.priority });
    time=end; completed++;
  }
  return { blocks, results:res, endTime:time };
}

// Round Robin Scheduling (RRS)
function roundRobin(processes, q){
  if(!(q>0)) throw new Error('Quantum must be a positive number for Round Robin');
  const n = processes.length; const res = new Map(); const blocks=[];
  const rem = processes.map(p=>p.burst);
  const firstStart = new Array(n).fill(null);
  const queue = [];
  let time = Math.min(...processes.map(p=>p.arrival));
  for(let i=0;i<n;i++){ if(processes[i].arrival<=time) queue.push(i); }
  const arrived = new Set(queue);
  while(queue.length>0 || arrived.size < n){
    if(queue.length===0){
      const nextIdx = processes.findIndex((p,i)=>!arrived.has(i));
      if(nextIdx===-1) break;
      const nextTime = processes[nextIdx].arrival;
      blocks.push({ pid:'IDLE', start: time, end: nextTime, color:'var(--idle)'});
      time = nextTime; 
      for(let i=0;i<n;i++){ if(!arrived.has(i) && processes[i].arrival<=time) { queue.push(i); arrived.add(i); } }
      continue;
    }
    const i = queue.shift(); const p = processes[i];
    if(firstStart[i]===null){ 
      firstStart[i]=time; 
      res.set(p.pid, { start: time, completion:0, tat:0, wt:0, response: time - p.arrival, arrival:p.arrival, burst:p.burst, priority:p.priority }); 
    }
    const run = Math.min(q, rem[i]);
    const start = time; const end = time + run; blocks.push({ pid:p.pid, start, end, color:p.color });
    time = end; rem[i] -= run;
    for(let k=0;k<n;k++){ if(!arrived.has(k) && processes[k].arrival<=time){ queue.push(k); arrived.add(k); } }
    if(rem[i] > 0){ queue.push(i); } else {
      const completion = time; const r = res.get(p.pid);
      r.completion = completion; r.tat = completion - p.arrival; r.wt = r.tat - p.burst; res.set(p.pid, r);
    }
  }
  return { blocks, results: res, endTime: time };
}


   // ---------- Results & UI binding ----------
  function compute(){
    setError('');
    let procs;
    try{ procs = readProcesses(); }
    catch(e){ setError(e.message); return; }
    if(procs.length===0){ setError('Add at least one process.'); return; }
    procs.forEach((p,idx)=>{ if(!p.color){ p.color = genColor(idx, procs.length); } });

    const algo = $('#algo').value; const q = Number($('#quantum').value);
    let out;
    if(algo==='FCFS') out = fcfs(procs);
    else if(algo==='SJF') out = sjf(procs);
    else if(algo==='SRTF') out = srtf(procs);
    else if(algo==='PR') out = prioritySchedule(procs);
    else if(algo==='RR') out = roundRobin(procs, q);

    renderLegend(procs);
    renderGantt(out.blocks, Number($('#scale').value));
    renderResultsTable(procs, out.results);
    renderAverages(out.results, out.endTime, procs);
  }

  function renderResultsTable(procs, resMap){
    const tbody = $('#rtable tbody'); tbody.innerHTML = '';
    const order = procs.map(p=>p.pid);
    for(const pid of order){
      const p = procs.find(x=>x.pid===pid); const r = resMap.get(pid);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${pid}</td>
        <td>${p.arrival}</td>
        <td>${p.burst}</td>
        <td>${p.priority}</td>
        <td>${r?.start ?? '—'}</td>
        <td>${r?.completion ?? '—'}</td>
        <td>${r?.tat ?? '—'}</td>
        <td>${r?.wt ?? '—'}</td>
        <td>${r?.response ?? '—'}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function renderAverages(resMap, endTime, procs){
    let sumCT=0, sumTAT=0, sumWT=0; let minArrival = Math.min(...procs.map(p=>p.arrival));
    for(const pid of resMap.keys()){
      const r = resMap.get(pid); sumCT += r.completion; sumTAT += r.tat; sumWT += r.wt;
    }
    const n = resMap.size;
    $('#avgCT').textContent = (sumCT/n).toFixed(2);
    $('#avgTAT').textContent = (sumTAT/n).toFixed(2);
    $('#avgWT').textContent = (sumWT/n).toFixed(2);
    const totalTime = endTime - minArrival; const throughput = totalTime>0 ? (n/totalTime) : n;
    $('#throughput').textContent = throughput.toFixed(3);
  }

  function addRow(pid, at, bt, pr, color){
    const tbody = $('#ptable tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="pid" type="text" value="${pid}"/></td>
      <td><input class="at" type="number" min="0" value="${at}"/></td>
      <td><input class="bt" type="number" min="1" value="${bt}"/></td>
      <td><input class="pr" type="number" value="${pr}"/></td>
      <td><input class="color" type="text" value="${color}"/></td>
      <td class="row-actions"><button class="ghost del">Delete</button></td>
    `;
    tbody.appendChild(tr);
    tr.querySelector('.del').addEventListener('click', ()=>{ tr.remove(); });
  }

  function seedSample(){
    $('#ptable tbody').innerHTML = '';
    const sample = [
      {pid:'P1', at:0, bt:7, pr:2},
      {pid:'P2', at:2, bt:4, pr:1},
      {pid:'P3', at:4, bt:1, pr:3},
      {pid:'P4', at:5, bt:4, pr:4},
      {pid:'P5', at:6, bt:6, pr:2},
    ];
    sample.forEach((p,i)=> addRow(p.pid, p.at, p.bt, p.pr, genColor(i, sample.length)));
  }

  function resetAll(){
    $('#ptable tbody').innerHTML='';
    $('#rtable tbody').innerHTML='';
    $('#legend').innerHTML='';
    $('#gantt').innerHTML='';
    $('#ticks').innerHTML='';
    setError('');
    $('#avgCT').textContent='—'; $('#avgTAT').textContent='—'; $('#avgWT').textContent='—'; $('#throughput').textContent='—';
  }

  function updateQuantumVisibility(){
    const show = $('#algo').value==='RR';
    $('#qField').style.display = show? 'block' : 'none';
  }

  // ---------- Init ----------
  updateQuantumVisibility();
  $('#algo').addEventListener('change', updateQuantumVisibility);
  $('#scale').addEventListener('input', (e)=>{ $('#scaleLabel').textContent = e.target.value; });
  $('#compute').addEventListener('click', compute);
  $('#addRow').addEventListener('click', ()=>{
    const idx = $$('#ptable tbody tr').length + 1;
    addRow('P'+idx, 0, 1, 1, genColor(idx-1, Math.max(6, idx)));
  });
  $('#seed').addEventListener('click', seedSample);
  $('#reset').addEventListener('click', resetAll);
  seedSample();

}); // <-- DOMContentLoaded end
