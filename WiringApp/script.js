
/* ============================================================
   WIRING DESIGNER v4 – script.js
   + WireType visual manager  + Wire notes panel
   ============================================================ */
'use strict';

// ─── LOGGER ─────────────────────────────────────────────────
const Logger = (() => {
  let on=false;
  return { log:(...a)=>{ if(on) console.log('[WD]',...a); }, setEnabled:v=>{on=!!v;} };
})();

// ─── LABVIEW BRIDGE ─────────────────────────────────────────
const LVBridge = (() => {
  function send(type,action,payload){
    const msg=JSON.stringify({type,action,payload});
    Logger.log('→LV',msg);
    if(window.chrome?.webview) window.chrome.webview.postMessage(msg);
  }
  function init(){
    if(!window.chrome?.webview) return;
    window.chrome.webview.addEventListener('message',evt=>{
      try{ const d=typeof evt.data==='string'?JSON.parse(evt.data):evt.data; Logger.log('←LV',d); handleCmd(d); }
      catch(e){ Logger.log('ParseErr',e); }
    });
  }
  function handleCmd({type,action,payload}){
    if(type!=='command') return;
    switch(action){
      case 'loadProject': ProjectMgr.load(payload); break;
      case 'getWiring':   send('response','wiringData',State.connections); break;
      case 'clearConns':  WiringApp.clearConnections(); break;
      case 'setLog':      Logger.setEnabled(payload.enabled);
                          document.getElementById('logToggle').checked=!!payload.enabled; break;
      default: Logger.log('UnknownCmd',action);
    }
  }
  return {send,init};
})();

// ─── STATE ──────────────────────────────────────────────────
const State = {
  projectName:'Nuovo Progetto',
  wireTypes:[],
  clusters:{left:[],right:[]},
  active:{left:null,right:null},
  connections:[],
  devices:[],          // device library
  canvasDevices:[],    // [{id, devId, side:'canvas', x, y}] placed on canvas
  _uid:1,
  uid(p='x'){return p+(this._uid++);}
};

// ─── PROJECT MANAGER ────────────────────────────────────────
const ProjectMgr = {
  load(data){
    State.projectName = data.project||'Progetto';
    State.wireTypes   = data.wireTypes||[];
    State.clusters.left  = data.clusters?.left||[];
    State.clusters.right = data.clusters?.right||[];
    State.connections = (data.connections||[]).map(c=>{
      // resolve names from pins (handles JSON files that don't carry them)
      let lp=null,rp=null;
      for(const cl of State.clusters.left)  { const p=cl.pins.find(p=>p.id===c.leftId);  if(p){lp=p;break;} }
      for(const cl of State.clusters.right) { const p=cl.pins.find(p=>p.id===c.rightId); if(p){rp=p;break;} }
      return { note:'', length:'', label:'', ...c,
        leftName:  lp?.name  || c.leftName  || c.leftId,
        rightName: rp?.name  || c.rightName || c.rightId,
        leftType:  lp?.type  || c.leftType  || '',
        rightType: rp?.type  || c.rightType || '',
        wireTypeId: c.wireTypeId || lp?.wireTypeId || rp?.wireTypeId || null
      };
    });
    // also load devices if present
    State.devices = data.devices||[];
    State.canvasDevices = data.canvasDevices||[];
    State.active.left  = State.clusters.left[0]?.id||null;
    State.active.right = State.clusters.right[0]?.id||null;
    ClusterMgr.renderSelectors();
    ClusterMgr.renderList('left');
    ClusterMgr.renderList('right');
    WireTypeMgr.render();
    DeviceMgr.render();
    setTimeout(()=>{ SVGCanvas.redraw(); CanvasDevices.render(); },100);
    LVBridge.send('event','projectLoaded',{name:State.projectName});
  },
  toJSON(){
    return {project:State.projectName,version:'4.7',
      wireTypes:State.wireTypes,clusters:State.clusters,
      connections:State.connections,devices:State.devices,canvasDevices:State.canvasDevices};
  }
};

// ─── WIRE TYPE MANAGER ──────────────────────────────────────
const WireTypeMgr = {
  render(){
    const c=document.getElementById('wtContainer');
    if(!State.wireTypes.length){
      c.innerHTML='<p class="wt-empty">Nessun tipo di cavo. Premi "＋ Nuovo tipo cavo".</p>'; return;
    }
    c.innerHTML='';
    State.wireTypes.forEach(wt=>{
      const usedCount = [...State.clusters.left,...State.clusters.right]
        .flatMap(cl=>cl.pins).filter(p=>p.wireTypeId===wt.id).length;
      const connCount = State.connections.filter(c=>c.wireTypeId===wt.id).length;
      const card=document.createElement('div');
      card.className='wt-card';
      card.style.setProperty('--wt-color',wt.color);
      card.innerHTML=`
        <div class="wt-swatch" style="background:${wt.color}"></div>
        <div class="wt-info">
          <span class="wt-name">${_esc(wt.name)}</span>
          <div class="wt-meta">
            <span class="wt-meta-item">Sezione: <strong>${_esc(wt.section||'—')}</strong></span>
            <span class="wt-meta-item">Tensione: <strong>${_esc(wt.voltage||'—')}</strong></span>
            <span class="wt-meta-item">Colore: <strong>${wt.color}</strong></span>
          </div>
          ${wt.notes?`<span class="wt-notes-text">${_esc(wt.notes)}</span>`:''}
        </div>
        <span class="wt-usage-badge${usedCount>0?' used':''}" title="Pin che usano questo cavo">${usedCount} pin</span>
        <span class="wt-usage-badge${connCount>0?' used':''}" title="Connessioni con questo cavo">${connCount} conn.</span>
        <div class="wt-actions">
          <button class="btn-wt-edit" onclick="WireTypeMgr.openEdit('${wt.id}')">✏ Modifica</button>
          <button class="btn-wt-del"  onclick="WireTypeMgr.delete('${wt.id}')">🗑</button>
        </div>`;
      c.appendChild(card);
    });
  },

  _form(wt){
    const v=wt||{name:'',color:'#4fc3f7',section:'',voltage:'',notes:''};
    return `
      <div class="modal-row">
        <label>Nome cavo <input id="wt_name" value="${_esc(v.name)}" placeholder="es. Rosso 1mm²"/></label>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <label style="flex:1">Colore
            <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
              <input type="color" id="wt_color" value="${v.color}" style="flex-shrink:0"
                oninput="document.getElementById('wt_colorhex').value=this.value"/>
              <input id="wt_colorhex" value="${v.color}" placeholder="#rrggbb" style="flex:1;font-family:monospace"
                oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value)) document.getElementById('wt_color').value=this.value"/>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-row">
        <label>Sezione <input id="wt_section" value="${_esc(v.section||'')}" placeholder="es. 1mm²"/></label>
        <label>Tensione / Tipo <input id="wt_voltage" value="${_esc(v.voltage||'')}" placeholder="es. 24V, CAN, PE"/></label>
      </div>
      <label>Note / Descrizione <textarea id="wt_notes" rows="2">${_esc(v.notes||'')}</textarea></label>`;
  },

  openAdd(){
    Modal.open('Nuovo Tipo Cavo', this._form(null), ()=>{
      const name=document.getElementById('wt_name').value.trim(); if(!name) return false;
      State.wireTypes.push({
        id:State.uid('wt'), name,
        color:document.getElementById('wt_color').value,
        section:document.getElementById('wt_section').value,
        voltage:document.getElementById('wt_voltage').value,
        notes:document.getElementById('wt_notes').value
      });
      this.render();
      LVBridge.send('event','wireTypeAdded',{name});
    },'wt_name');
  },

  openEdit(id){
    const wt=State.wireTypes.find(w=>w.id===id); if(!wt) return;
    Modal.open(`Modifica — ${wt.name}`, this._form(wt), ()=>{
      const name=document.getElementById('wt_name').value.trim(); if(!name) return false;
      wt.name    = name;
      wt.color   = document.getElementById('wt_color').value;
      wt.section = document.getElementById('wt_section').value;
      wt.voltage = document.getElementById('wt_voltage').value;
      wt.notes   = document.getElementById('wt_notes').value;
      this.render();
      ClusterMgr.renderList('left'); ClusterMgr.renderList('right');
      SVGCanvas.redraw();
    },'wt_name');
  },

  delete(id){
    const wt=State.wireTypes.find(w=>w.id===id); if(!wt) return;
    const used=[...State.clusters.left,...State.clusters.right].flatMap(c=>c.pins).filter(p=>p.wireTypeId===id).length;
    const msg=used>0?`Questo tipo cavo è usato da ${used} pin. Rimuoverlo ugualmente?`:`Eliminare il tipo cavo "${wt.name}"?`;
    if(!confirm(msg)) return;
    State.wireTypes=State.wireTypes.filter(w=>w.id!==id);
    // detach from pins & connections
    [...State.clusters.left,...State.clusters.right].flatMap(c=>c.pins)
      .filter(p=>p.wireTypeId===id).forEach(p=>{ delete p.wireTypeId; });
    State.connections.filter(c=>c.wireTypeId===id).forEach(c=>{ delete c.wireTypeId; });
    this.render();
    ClusterMgr.renderList('left'); ClusterMgr.renderList('right');
    SVGCanvas.redraw();
  }
};

// ─── WIRE NOTES PANEL ───────────────────────────────────────
const WireNotes = (() => {
  let activeConnId = null;
  const cardOffsets = {};  // connId -> {dx, dy} user drag offset

  function select(connId){
    // deselect previous
    document.querySelectorAll('#wiresGroup .wire.selected').forEach(el=>el.classList.remove('selected'));
    activeConnId = connId;
    const conn = State.connections.find(c=>c.id===connId);
    if(!conn){ deselect(); return; }

    // highlight wire
    const wire = document.querySelector(`#wiresGroup .wire[data-conn-id="${connId}"]`);
    if(wire) wire.classList.add('selected');

    const wt = State.wireTypes.find(w=>w.id===conn.wireTypeId);
    const wtOpts = State.wireTypes.map(w=>`<option value="${w.id}"${w.id===conn.wireTypeId?' selected':''}>${w.name}</option>`).join('');

    // update header label
    // show the notes panel
    const panel = document.getElementById('wireNotesPanel');
    if(panel) panel.classList.add('wn-visible');
    const lbl = document.getElementById('wn-conn-label');
    lbl.textContent = `${conn.leftName}  →  ${conn.rightName}`;
    lbl.classList.add('active');

    // render form
    document.getElementById('wnBody').innerHTML=`
      <div class="wn-form">
        <div class="wn-row">
          <div class="wn-field">
            <label>Tipo Cavo</label>
            <select id="wn_wire"><option value="">— nessuno —</option>${wtOpts}</select>
          </div>
          <div class="wn-field">
            <label>Lunghezza stimata</label>
            <input id="wn_length" value="${_esc(conn.length||'')}" placeholder="es. 1.5m"/>
          </div>
          <div class="wn-field">
            <label>Etichetta filo</label>
            <input id="wn_label" value="${_esc(conn.label||'')}" placeholder="es. W001"/>
          </div>
        </div>
        <div class="wn-field">
          <label>Note di cablaggio</label>
          <textarea id="wn_note" rows="2" placeholder="Istruzioni, avvertenze, percorso canalina...">${_esc(conn.note||'')}</textarea>
        </div>
        <div class="wn-save-row">
          <button class="btn-wn-del" onclick="SVGCanvas.removeConnection('${connId}')">🗑 Elimina connessione</button>
          <span class="wn-saved-msg" id="wnSavedMsg">✔ Salvato</span>
          <button class="btn-wn-save" onclick="WireNotes.save('${connId}')">💾 Salva note</button>
        </div>
      </div>`;

    // auto-update wireTypeId preview
    document.getElementById('wn_wire').addEventListener('change', e=>{
      conn.wireTypeId = e.target.value||undefined;
      SVGCanvas.redraw();
      // re-select
      setTimeout(()=>select(connId),60);
    });
  }

  function save(connId){
    const conn=State.connections.find(c=>c.id===connId); if(!conn) return;
    conn.note   = document.getElementById('wn_note')?.value||'';
    conn.length = document.getElementById('wn_length')?.value||'';
    conn.label  = document.getElementById('wn_label')?.value||'';
    const wv    = document.getElementById('wn_wire')?.value;
    conn.wireTypeId = wv||undefined;
    // flash saved
    const msg=document.getElementById('wnSavedMsg');
    if(msg){ msg.classList.add('show'); setTimeout(()=>msg.classList.remove('show'),1800); }
    SVGCanvas.redraw();
    ClusterMgr.renderList('left'); ClusterMgr.renderList('right');
    // re-render notes panel so wire type select reflects new state
    setTimeout(()=>WireNotes.select(connId), 60);
    LVBridge.send('event','wireNoteSaved',{id:connId,note:conn.note,label:conn.label});
  }

  function deselect(){
    activeConnId=null;
    document.querySelectorAll('#wiresGroup .wire.selected').forEach(el=>el.classList.remove('selected'));
    document.getElementById('wn-conn-label').textContent='Clicca su un filo per aggiungere note';
    document.getElementById('wn-conn-label').classList.remove('active');
    document.getElementById('wnBody').innerHTML='<p class="wn-hint">Clicca su un filo nel canvas per selezionarlo e aggiungere note.</p>';
    // collapse the notes panel
    const panel = document.getElementById('wireNotesPanel');
    if(panel) panel.classList.remove('wn-visible');
  }

  function getOffset(connId){ return cardOffsets[connId]||{dx:0,dy:0}; }
  function setOffset(connId,dx,dy){ cardOffsets[connId]={dx,dy}; }
  return {select, save, deselect, getActive:()=>activeConnId, getOffset, setOffset};
})();

// ─── CLUSTER MANAGER ────────────────────────────────────────
const ClusterMgr = {
  renderSelectors(){
    ['left','right'].forEach(side=>{
      const sel=document.getElementById('clusterSelect-'+side);
      sel.innerHTML='<option value="">— nessun cluster —</option>';
      State.clusters[side].forEach(cl=>{
        const o=document.createElement('option');
        o.value=cl.id; o.textContent=(cl.icon?cl.icon+' ':'')+cl.name; sel.appendChild(o);
      });
      sel.value=State.active[side]||'';
      this._toggleActionBar(side);
    });
    this._updateActiveInfo();
    this._updateTableFilter();
  },
  selectCluster(side,id){
    State.active[side]=id||null;
    this._toggleActionBar(side);
    this.renderList(side);
    SVGCanvas.redraw();
    this._updateActiveInfo();
  },
  _toggleActionBar(side){
    document.getElementById('cluster-actions-'+side).style.display=State.active[side]?'flex':'none';
  },
  _updateActiveInfo(){
    const lc=State.clusters.left.find(c=>c.id===State.active.left);
    const rc=State.clusters.right.find(c=>c.id===State.active.right);
    document.getElementById('activeInfo').textContent=
      (lc?(lc.icon?lc.icon+' ':'')+lc.name:'—')+'  ↔  '+(rc?(rc.icon?rc.icon+' ':'')+rc.name:'—');
  },
  _updateTableFilter(){
    const sel=document.getElementById('tableFilter');
    const prev=sel.value;
    sel.innerHTML='<option value="">Tutti</option>';
    [...State.clusters.left,...State.clusters.right].forEach(cl=>{
      const o=document.createElement('option'); o.value=cl.id; o.textContent=cl.name; sel.appendChild(o);
    });
    sel.value=prev;
  },
  renderList(side){
    const ul=document.getElementById('list-'+side);
    ul.innerHTML='';
    const cl=State.clusters[side].find(c=>c.id===State.active[side]);
    if(!cl){
      ul.innerHTML='<p style="color:var(--text-muted);font-size:11px;padding:16px 10px;text-align:center">Seleziona o crea un cluster</p>';
      return;
    }
    const usedWires=[...new Set(cl.pins.map(p=>p.wireTypeId).filter(Boolean))];
    if(usedWires.length){
      const leg=document.createElement('div'); leg.className='wire-legend';
      usedWires.forEach(wid=>{
        const wt=State.wireTypes.find(w=>w.id===wid); if(!wt) return;
        leg.innerHTML+=`<span class="wire-badge"><span class="wire-dot" style="background:${wt.color}"></span>${wt.name}</span>`;
      });
      ul.appendChild(leg);
    }
    cl.pins.forEach((pin,idx)=>{
      const connCount=State.connections.filter(c=>c.leftId===pin.id||c.rightId===pin.id).length;
      const wt=State.wireTypes.find(w=>w.id===pin.wireTypeId);
      const wireColor=wt?.color||'var(--text-muted)';
      const isMulti=connCount>1, isConn=connCount===1;
      const item=document.createElement('div');
      item.className='signal-item'+(isMulti?' multi-conn':isConn?' connected':'');
      item.dataset.id=pin.id; item.dataset.side=side; item.dataset.clId=cl.id; item.dataset.idx=idx;
      item.draggable=true;
      item.innerHTML=`
        <span class="drag-handle" title="Trascina per riordinare">⠿</span>
        <span class="sig-color-bar" style="background:${wireColor}"></span>
        <span class="sig-name" title="${pin.description||pin.name}">${pin.name}</span>
        <span class="sig-type">${pin.type||''}</span>
        ${wt?`<span class="sig-wire-badge" style="background:${wt.color};color:${_contrast(wt.color)}">${wt.name.split(' ')[0]}</span>`:''}
        <span class="sig-conn-count${connCount>1?' visible':''}">${connCount}×</span>
        <button class="btn-props"
          onmouseenter="PinTooltip.show(event,'${side}','${pin.id}')"
          onmouseleave="PinTooltip.hide()"
          onclick="PinMgr.openProps('${side}','${cl.id}','${pin.id}')">⚙</button>
        <button class="btn-del" onclick="PinMgr.deletePin('${side}','${cl.id}','${pin.id}')">×</button>
        <div class="signal-anchor" data-id="${pin.id}" data-side="${side}"></div>`;
      item.addEventListener('dragstart',ReorderDrag.onDragStart);
      item.addEventListener('dragend',  ReorderDrag.onDragEnd);
      item.addEventListener('dragover', ReorderDrag.onDragOver);
      item.addEventListener('drop',     ReorderDrag.onDrop);
      item.querySelector('.signal-anchor').addEventListener('mousedown',SVGCanvas.startWire);
      ul.appendChild(item);
    });
  },
  openAddCluster(side){
    Modal.open(`Nuovo Cluster — ${side==='left'?'Sorgente':'Destinazione'}`,
      `<label>Nome <input id="m_name" placeholder="es. Connettore J3"/></label>
       <div class="modal-row">
         <label>Icona emoji <input id="m_icon" placeholder="🔌"/></label>
         <label>Descrizione <input id="m_desc" placeholder="opzionale"/></label>
       </div>`,
      ()=>{
        const name=document.getElementById('m_name').value.trim(); if(!name) return false;
        const cl={id:State.uid('cl'),name,icon:document.getElementById('m_icon').value||'📦',
          description:document.getElementById('m_desc').value,pins:[]};
        State.clusters[side].push(cl); State.active[side]=cl.id;
        this.renderSelectors(); this.renderList(side);
      },'m_name');
  },
  openEditCluster(side){
    const cl=State.clusters[side].find(c=>c.id===State.active[side]); if(!cl) return;
    Modal.open(`Modifica — ${cl.name}`,
      `<label>Nome <input id="m_name" value="${_esc(cl.name)}"/></label>
       <div class="modal-row">
         <label>Icona <input id="m_icon" value="${_esc(cl.icon||'')}"/></label>
         <label>Descrizione <input id="m_desc" value="${_esc(cl.description||'')}"/></label>
       </div>`,
      ()=>{
        const name=document.getElementById('m_name').value.trim(); if(!name) return false;
        cl.name=name; cl.icon=document.getElementById('m_icon').value||'📦';
        cl.description=document.getElementById('m_desc').value;
        this.renderSelectors(); this.renderList(side);
      },'m_name');
  },
  deleteCluster(side){
    const cl=State.clusters[side].find(c=>c.id===State.active[side]); if(!cl) return;
    if(!confirm(`Eliminare il cluster "${cl.name}" e tutti i suoi pin?`)) return;
    const ids=cl.pins.map(p=>p.id);
    State.connections=State.connections.filter(c=>!ids.includes(c.leftId)&&!ids.includes(c.rightId));
    State.clusters[side]=State.clusters[side].filter(c=>c.id!==cl.id);
    State.active[side]=State.clusters[side][0]?.id||null;
    this.renderSelectors(); this.renderList(side); SVGCanvas.redraw();
  },
  openAddPin(side){
    const clId=State.active[side]; if(!clId) return;
    const wtOpts=State.wireTypes.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
    Modal.open('Aggiungi Pin',
      `<div class="modal-row">
         <label>Nome pin <input id="m_pname" placeholder="es. PIN9"/></label>
         <label>Tipo <select id="m_ptype">${['PIN','TERMINAL','SENSOR','DAQ','PWR','GND','OTHER'].map(t=>`<option>${t}</option>`).join('')}</select></label>
       </div>
       <label>Tipo cavo <select id="m_pwire"><option value="">— nessuno —</option>${wtOpts}</select></label>
       <div class="modal-row">
         <label>Descrizione <input id="m_pdesc" placeholder="es. Alimentazione +24V"/></label>
         <label>Note <input id="m_pnote" placeholder="es. Fusibile 2A"/></label>
       </div>`,
      ()=>{
        const name=document.getElementById('m_pname').value.trim(); if(!name) return false;
        const cl=State.clusters[side].find(c=>c.id===clId); if(!cl) return false;
        cl.pins.push({id:State.uid('p'),name,type:document.getElementById('m_ptype').value,
          wireTypeId:document.getElementById('m_pwire').value||undefined,
          description:document.getElementById('m_pdesc').value,note:document.getElementById('m_pnote').value});
        this.renderList(side); SVGCanvas.redraw();
      },'m_pname');
  }
};

// ─── PIN MANAGER ────────────────────────────────────────────
const PinMgr = {
  deletePin(side,clId,pinId){
    const cl=State.clusters[side].find(c=>c.id===clId); if(!cl) return;
    cl.pins=cl.pins.filter(p=>p.id!==pinId);
    State.connections=State.connections.filter(c=>c.leftId!==pinId&&c.rightId!==pinId);
    ClusterMgr.renderList(side); SVGCanvas.redraw();
  },
  openProps(side,clId,pinId){
    PinTooltip.hide();
    let pin=null;
    for(const cl of State.clusters[side]){ pin=cl.pins.find(p=>p.id===pinId); if(pin) break; }
    if(!pin) return;
    const wtOpts=State.wireTypes.map(w=>`<option value="${w.id}"${w.id===pin.wireTypeId?' selected':''}>${w.name}</option>`).join('');
    Modal.open(`Proprietà Pin — ${pin.name}`,
      `<div class="modal-row">
         <label>Nome <input id="m_pname" value="${_esc(pin.name)}"/></label>
         <label>Tipo <select id="m_ptype">${['PIN','TERMINAL','SENSOR','DAQ','PWR','GND','OTHER'].map(t=>`<option${t===pin.type?' selected':''}>${t}</option>`).join('')}</select></label>
       </div>
       <label>Tipo cavo <select id="m_pwire"><option value="">— nessuno —</option>${wtOpts}</select></label>
       <div class="modal-row">
         <label>Descrizione <input id="m_pdesc" value="${_esc(pin.description||'')}"/></label>
         <label>Note <input id="m_pnote" value="${_esc(pin.note||'')}"/></label>
       </div>`,
      ()=>{
        pin.name=document.getElementById('m_pname').value.trim()||pin.name;
        pin.type=document.getElementById('m_ptype').value;
        pin.wireTypeId=document.getElementById('m_pwire').value||undefined;
        pin.description=document.getElementById('m_pdesc').value;
        pin.note=document.getElementById('m_pnote').value;
        ClusterMgr.renderList(side); SVGCanvas.redraw();
      },'m_pname');
  }
};

// ─── PIN TOOLTIP ────────────────────────────────────────────
const PinTooltip = (() => {
  const el=document.getElementById('pinTooltip'); let t;
  return {
    show(evt,side,pinId){
      clearTimeout(t);
      let pin=null;
      for(const cl of State.clusters[side]){pin=cl.pins.find(p=>p.id===pinId);if(pin)break;}
      if(!pin) return;
      const wt=State.wireTypes.find(w=>w.id===pin.wireTypeId);
      const cc=State.connections.filter(c=>c.leftId===pin.id||c.rightId===pin.id).length;
      el.innerHTML=`
        <div class="tt-row"><span class="tt-label">Nome:</span><span class="tt-val">${pin.name}</span></div>
        <div class="tt-row"><span class="tt-label">Tipo:</span><span class="tt-val">${pin.type||'—'}</span></div>
        ${pin.description?`<div class="tt-row"><span class="tt-label">Descr.:</span><span class="tt-val">${pin.description}</span></div>`:''}
        ${pin.note?`<div class="tt-row"><span class="tt-label">Note:</span><span class="tt-val">${pin.note}</span></div>`:''}
        ${wt?`<div class="tt-row"><span class="tt-label">Cavo:</span><span class="tt-val"><span class="tt-color" style="background:${wt.color}"></span> ${wt.name}</span></div>
              <div class="tt-row"><span class="tt-label">Sezione:</span><span class="tt-val">${wt.section||'—'}</span></div>
              <div class="tt-row"><span class="tt-label">Tensione:</span><span class="tt-val">${wt.voltage||'—'}</span></div>`:''}
        <div class="tt-row" style="margin-top:4px"><span class="tt-label">Conn.:</span>
          <span class="tt-val" style="color:${cc>1?'var(--accent3)':cc===1?'var(--accent2)':'var(--text-muted)'}">${cc}</span></div>`;
      el.style.display='block';
      const r=evt.target.getBoundingClientRect();
      let left=r.left-220; if(left<4) left=r.right+6;
      el.style.top=r.top+'px'; el.style.left=left+'px';
    },
    hide(){ t=setTimeout(()=>el.style.display='none',150); }
  };
})();

// ─── REORDER DRAG ────────────────────────────────────────────
const ReorderDrag = (() => {
  let srcId=null,srcSide=null,srcClId=null,srcIdx=null;
  return {
    onDragStart(e){
      const it=e.currentTarget;
      srcId=it.dataset.id;srcSide=it.dataset.side;srcClId=it.dataset.clId;srcIdx=parseInt(it.dataset.idx);
      e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','reorder');
      setTimeout(()=>it.classList.add('dragging'),0);
    },
    onDragEnd(e){ e.currentTarget.classList.remove('dragging');
      document.querySelectorAll('.signal-item').forEach(i=>i.classList.remove('drag-over-item')); },
    onDragOver(e){ e.preventDefault();
      const it=e.currentTarget;
      if(it.dataset.id===srcId||it.dataset.side!==srcSide||it.dataset.clId!==srcClId) return;
      document.querySelectorAll('.signal-item').forEach(i=>i.classList.remove('drag-over-item'));
      it.classList.add('drag-over-item');
    },
    onDrop(e){ e.preventDefault();
      const it=e.currentTarget; it.classList.remove('drag-over-item');
      if(!srcId||it.dataset.id===srcId||it.dataset.side!==srcSide||it.dataset.clId!==srcClId) return;
      const tgtIdx=parseInt(it.dataset.idx);
      const cl=State.clusters[srcSide].find(c=>c.id===srcClId); if(!cl) return;
      const [moved]=cl.pins.splice(srcIdx,1); cl.pins.splice(tgtIdx,0,moved);
      ClusterMgr.renderList(srcSide); SVGCanvas.redraw(); srcId=null;
    }
  };
})();


// ─── CANVAS DEVICES (floating draggable HW boxes) ───────────
const CanvasDevices = (() => {
  const OVERLAY_ID = 'canvasDevOverlay';
  let _isDragging = false;

  function getOverlay(){
    let el=document.getElementById(OVERLAY_ID);
    if(!el){
      el=document.createElement('div');
      el.id=OVERLAY_ID; el.style.cssText='position:absolute;inset:0;pointer-events:none;';
      document.getElementById('canvasContainer').appendChild(el);
    }
    return el;
  }

  function render(){
    const overlay=getOverlay();
    overlay.innerHTML='';
    State.canvasDevices.forEach(cd=>{
      const dev=State.devices.find(d=>d.id===cd.devId); if(!dev) return;
      const box=document.createElement('div');
      box.className='canvas-dev-box';
      box.style.left=cd.x+'px'; box.style.top=cd.y+'px';
      box.dataset.cdId=cd.id;

      // header
      const hdr=document.createElement('div');
      hdr.className='cdb-header';
      hdr.innerHTML=`
        <span class="cdb-icon">${dev.icon||'🖥'}</span>
        <span class="cdb-name">${_esc(dev.name)}</span>
        <button class="cdb-close" onclick="CanvasDevices.remove('${cd.id}')" title="Rimuovi dal canvas">×</button>`;
      box.appendChild(hdr);

      // pins list — same style as side panel
      const pinsDiv=document.createElement('div');
      pinsDiv.className='cdb-pins';
      dev.pins.forEach(pin=>{
        const wt=State.wireTypes.find(w=>w.id===pin.wireTypeId);
        const wireColor=wt?.color||'var(--text-muted)';
        const connCount=State.connections.filter(c=>c.leftId===pin.id||c.rightId===pin.id).length;
        const isMulti=connCount>1, isConn=connCount===1;
        const item=document.createElement('div');
        item.className='signal-item cdb-pin-item'+(isMulti?' multi-conn':isConn?' connected':'');
        item.innerHTML=`
          <div class="signal-anchor cdb-anchor cdb-anchor-left"  data-id="${pin.id}" data-side="right" title="← Ricevi da Sorgente (pannello sx)"></div>
          <span class="sig-color-bar" style="background:${wireColor}"></span>
          <span class="sig-name">${_esc(pin.name)}</span>
          <span class="sig-type">${pin.type||''}</span>
          ${wt?`<span class="sig-wire-badge" style="background:${wt.color};color:${_contrast(wt.color)}">${wt.name.split(' ')[0]}</span>`:''}
          <span class="sig-conn-count${connCount>1?' visible':''}">${connCount}×</span>
          <div class="signal-anchor cdb-anchor cdb-anchor-right" data-id="${pin.id}" data-side="left"  title="Invia a Destinazione → (pannello dx)"></div>`;
        item.querySelectorAll('.cdb-anchor').forEach(a=>{
          a.addEventListener('mousedown', e=>{ e.stopPropagation(); SVGCanvas.startWire(e); });
        });
        pinsDiv.appendChild(item);
      });
      box.appendChild(pinsDiv);

      // drag
      makeDraggable(box, cd);
      overlay.appendChild(box);
    });
  }

  function makeDraggable(box, cd){
    const hdr=box.querySelector('.cdb-header');
    let dragging=false, ox=0, oy=0;
    hdr.style.cursor='grab';
    hdr.addEventListener('mousedown',e=>{
      if(e.target.classList.contains('cdb-close')) return;
      e.preventDefault(); dragging=true;
      ox=e.clientX-cd.x; oy=e.clientY-cd.y;
      hdr.style.cursor='grabbing';
      box.style.zIndex=999;
      box.style.opacity='0.6';
      box.style.transition='none';
    });
    document.addEventListener('mousemove',e=>{
      if(!dragging) return;
      cd.x=e.clientX-ox; cd.y=e.clientY-oy;
      // update position directly — no full render to avoid destroying drag state
      box.style.left=cd.x+'px'; box.style.top=cd.y+'px';
      SVGCanvas.redrawWiresOnly(); // only redraw SVG wires, not the overlay
    });
    document.addEventListener('mouseup',()=>{
      if(!dragging) return;
      dragging=false;
      hdr.style.cursor='grab';
      box.style.zIndex='';
      box.style.opacity='1';
      box.style.transition='opacity .2s';
      SVGCanvas.redraw(); // full redraw on release
    });
  }

  function remove(cdId){
    State.canvasDevices=State.canvasDevices.filter(cd=>cd.id!==cdId);
    render(); SVGCanvas.redraw();
  }

  // Make canvas-pinned device pins findable by SVGCanvas.findPin
  function findPin(id){
    for(const cd of State.canvasDevices){
      const dev=State.devices.find(d=>d.id===cd.devId); if(!dev) continue;
      const p=dev.pins.find(p=>p.id===id); if(p) return p;
    }
    return null;
  }

  return {render, remove, findPin};
})();

// ─── SVG CANVAS ─────────────────────────────────────────────
const SVGCanvas = (() => {
  let svg,wiresGroup,drawing=false,tempWire=null,startAnchor=null;

  // Module-level card drag state (persistent across redraws)
  let cardDrag={active:false, connId:null, ox:0, oy:0, base:{dx:0,dy:0}};

  function init(){
    svg=document.getElementById('wiringSvg');
    wiresGroup=document.getElementById('wiresGroup');
    document.addEventListener('mousemove', e=>{
      onMouseMove(e);
      if(cardDrag.active){
        const sr=svg.getBoundingClientRect();
        const nx=e.clientX-sr.left, ny=e.clientY-sr.top;
        WireNotes.setOffset(cardDrag.connId,
          cardDrag.base.dx+(nx-cardDrag.ox),
          cardDrag.base.dy+(ny-cardDrag.oy));
        redraw();
      }
    });
    document.addEventListener('mouseup', e=>{
      onMouseUp(e);
      if(cardDrag.active){ cardDrag.active=false; svg.style.cursor=''; }
    });
    // SVG mousedown delegation for card drag
    svg.addEventListener('mousedown', e=>{
      const cardEl=e.target.closest('[data-drag-conn]');
      if(!cardEl) return;
      // don't interfere with wire drawing
      if(drawing) return;
      e.stopPropagation();
      const connId=cardEl.getAttribute('data-drag-conn');
      const sr=svg.getBoundingClientRect();
      cardDrag={
        active:true, connId,
        ox:e.clientX-sr.left, oy:e.clientY-sr.top,
        base:{...WireNotes.getOffset(connId)}
      };
      svg.style.cursor='grabbing';
    });
    window.addEventListener('resize',()=>setTimeout(redraw,60));

    // Delete/Backspace removes selected wire
    document.addEventListener('keydown', e=>{
      if((e.key==='Delete'||e.key==='Backspace') && WireNotes.getActive()){
        // avoid deleting while typing in an input/textarea
        if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
        removeConnection(WireNotes.getActive());
      }
    });

    // Document-level click → deselect if clicking outside protected zones
    document.addEventListener('click', e=>{
      if(!WireNotes.getActive()) return;
      const outside =
        !e.target.closest('#wireNotesPanel') &&
        !e.target.closest('.canvas-dev-box') &&
        !e.target.classList.contains('wire') &&
        !e.target.classList.contains('signal-anchor') &&
        !e.target.closest('#modalOverlay');
      if(outside) WireNotes.deselect();
    }, true); // capture phase so wire stopPropagation doesn't interfere
  }

  function getPos(el){
    const r=el.getBoundingClientRect(),sr=svg.getBoundingClientRect();
    return {x:r.left+r.width/2-sr.left,y:r.top+r.height/2-sr.top};
  }

  const startWire=function(e){
    e.preventDefault(); drawing=true; startAnchor=e.currentTarget;
    tempWire=document.createElementNS('http://www.w3.org/2000/svg','path');
    tempWire.setAttribute('class','wire temp'); wiresGroup.appendChild(tempWire);
  };

  function onMouseMove(e){
    if(!drawing||!tempWire) return;
    const p=getPos(startAnchor),sr=svg.getBoundingClientRect();
    setPath(tempWire,p.x,p.y,e.clientX-sr.left,e.clientY-sr.top);
  }

  function onMouseUp(e){
    if(!drawing) return;
    drawing=false; if(tempWire){tempWire.remove();tempWire=null;}
    const srcId   = startAnchor.dataset.id;
    const srcRole = startAnchor.dataset.side; // 'left' = source, 'right' = destination

    // Search ALL anchors in the document (panels + canvas device overlays)
    const allAnchors = document.querySelectorAll('.signal-anchor');
    for(const a of allAnchors){
      if(a === startAnchor) continue;
      const r = a.getBoundingClientRect();
      if(e.clientX < r.left-20 || e.clientX > r.right+20 ||
         e.clientY < r.top-20  || e.clientY > r.bottom+20) continue;

      const tgtId   = a.dataset.id;
      const tgtRole = a.dataset.side;

      // Same role (left+left or right+right) = not connectable
      if(srcRole === tgtRole) continue;

      // Role determines leftId/rightId regardless of panel or canvas
      const leftId  = srcRole === 'left' ? srcId : tgtId;
      const rightId = srcRole === 'left' ? tgtId : srcId;

      addConnection(leftId, rightId);
      startAnchor = null;
      return;
    }
    startAnchor = null;
  }

  function findPin(id){
    for(const s of['left','right'])
      for(const cl of State.clusters[s])
        for(const p of cl.pins) if(p.id===id) return p;
    // also search canvas devices
    const cp=CanvasDevices.findPin(id);
    if(cp) return cp;
    return null;
  }

  function addConnection(leftId,rightId){
    if(State.connections.find(c=>c.leftId===leftId&&c.rightId===rightId)) return;
    const lp=findPin(leftId),rp=findPin(rightId); if(!lp||!rp) return;
    const conn={id:State.uid('c'),leftId,rightId,leftName:lp.name,rightName:rp.name,
      leftType:lp.type,rightType:rp.type,wireTypeId:lp.wireTypeId||rp.wireTypeId||null,
      note:'',length:'',label:''};
    State.connections.push(conn);
    ClusterMgr.renderList('left'); ClusterMgr.renderList('right');
    redraw(); updateConnCount();
    LVBridge.send('event','connectionAdded',conn);
    // auto-open notes for new connection
    setTimeout(()=>WireNotes.select(conn.id),80);
  }

  function removeConnection(connId){
    State.connections=State.connections.filter(c=>c.id!==connId);
    if(WireNotes.getActive()===connId) WireNotes.deselect();
    ClusterMgr.renderList('left'); ClusterMgr.renderList('right');
    redraw(); updateConnCount();
    LVBridge.send('event','connectionRemoved',{id:connId});
  }

  function bezier(x1,y1,x2,y2){const cx=(x1+x2)/2;return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;}
  function setPath(el,x1,y1,x2,y2){el.setAttribute('d',bezier(x1,y1,x2,y2));}

  function redraw(){
    wiresGroup.innerHTML='';
    const activeConn=WireNotes.getActive();
    State.connections.forEach(conn=>{
      // search all anchors including canvas device overlays
      const la=document.querySelector(`.signal-anchor[data-id="${conn.leftId}"]`);
      const ra=document.querySelector(`.signal-anchor[data-id="${conn.rightId}"]`);
      if(!la||!ra) return;
      const p1=getPos(la),p2=getPos(ra);
      const wt=State.wireTypes.find(w=>w.id===conn.wireTypeId);
      const color=wt?.color||'#4fc3f7';
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','wire'+(conn.id===activeConn?' selected':''));
      path.setAttribute('stroke',color);
      path.setAttribute('data-conn-id',conn.id);
      path.setAttribute('marker-end','url(#arrowEnd)');
      setPath(path,p1.x,p1.y,p2.x,p2.y);
      // click: open notes panel
      // Hover preview: add 'hovered' class without selecting
      path.addEventListener('mouseenter', ()=>{
        if(conn.id !== WireNotes.getActive()) path.classList.add('hovered');
      });
      path.addEventListener('mouseleave', ()=>path.classList.remove('hovered'));
      path.addEventListener('click', e=>{ e.stopPropagation(); WireNotes.select(conn.id); });

      // ── wire labels: draggable floating card ──
      const midX=(p1.x+p2.x)/2, midY=(p1.y+p2.y)/2;
      const hasLabel = conn.label||conn.length||(wt?.name);
      if(hasLabel){
        const lines=[];
        if(conn.label)  lines.push({txt:conn.label, bold:true,  color:color,                    size:11});
        if(wt?.name)    lines.push({txt:wt.name,    bold:false, color:color,                    size:9});
        if(conn.length) lines.push({txt:'📏 '+conn.length, bold:false, color:'rgba(255,255,255,.7)', size:9});
        if(conn.note)   lines.push({txt:'📝 '+conn.note.slice(0,28)+(conn.note.length>28?'…':''),
                                    bold:false, color:'rgba(255,255,255,.55)', size:9});

        const PAD=7, LH=14;
        const cardW=Math.max(...lines.map(l=>l.txt.length*6.2))+PAD*2+4;
        const cardH=lines.length*LH+PAD*1.5;

        // base offset: 48px right, centred vertically; user drag adds on top
        const userOff = WireNotes.getOffset(conn.id);
        // base: 72px right, 20px above wire midpoint → card stays clear of the wire path
        const cx = midX + 72 + userOff.dx;
        const cy = midY - cardH - 10 + userOff.dy;

        // leader line from midpoint to card left edge centre
        const tick=document.createElementNS('http://www.w3.org/2000/svg','line');
        tick.setAttribute('x1',midX); tick.setAttribute('y1',midY);
        tick.setAttribute('x2',cx);   tick.setAttribute('y2',cy+cardH/2);
        tick.setAttribute('stroke',color); tick.setAttribute('stroke-opacity','0.4');
        tick.setAttribute('stroke-width','1.5'); tick.setAttribute('stroke-dasharray','4 3');
        tick.style.pointerEvents='none';
        wiresGroup.appendChild(tick);

        // card group (draggable)
        const cardG=document.createElementNS('http://www.w3.org/2000/svg','g');
        cardG.style.cursor='grab';
        cardG.setAttribute('data-card-conn',conn.id);

        const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');
        bg.setAttribute('x',cx); bg.setAttribute('y',cy);
        bg.setAttribute('width',cardW); bg.setAttribute('height',cardH);
        bg.setAttribute('rx','6'); bg.setAttribute('ry','6');
        bg.setAttribute('fill','#1e2229'); bg.setAttribute('fill-opacity','0.93');
        bg.setAttribute('stroke',color);  bg.setAttribute('stroke-opacity','0.6');
        bg.setAttribute('stroke-width','1.5');
        cardG.appendChild(bg);

        lines.forEach((l,i)=>{
          const t=document.createElementNS('http://www.w3.org/2000/svg','text');
          t.setAttribute('x',cx+PAD); t.setAttribute('y',cy+PAD+LH*i+LH*0.8);
          t.setAttribute('fill',l.color); t.setAttribute('font-size',l.size);
          t.setAttribute('font-family','Segoe UI,Arial,sans-serif');
          if(l.bold) t.setAttribute('font-weight','700');
          t.style.pointerEvents='none';
          t.textContent=l.txt;
          cardG.appendChild(t);
        });

        // mark card as draggable via data attribute — actual drag handled by SVG-level listener
        cardG.setAttribute('data-drag-conn', conn.id);
        cardG.style.cursor='grab';

        // card appended AFTER path → renders on top of wire
        wiresGroup.appendChild(path);
        wiresGroup.appendChild(tick);
        wiresGroup.appendChild(cardG);
      } else {
        wiresGroup.appendChild(path);
      }
    });
    document.getElementById('dropZoneMsg').style.display=State.connections.length>0?'none':'block';
    updateConnCount();
    CanvasDevices.render();
  }

  // Redraw only the SVG wires (no CanvasDevices.render) — used during drag
  function redrawWiresOnly(){
    wiresGroup.innerHTML='';
    const activeConn=WireNotes.getActive();
    State.connections.forEach(conn=>{
      const la=document.querySelector(`.signal-anchor[data-id="${conn.leftId}"]`);
      const ra=document.querySelector(`.signal-anchor[data-id="${conn.rightId}"]`);
      if(!la||!ra) return;
      const p1=getPos(la),p2=getPos(ra);
      const wt=State.wireTypes.find(w=>w.id===conn.wireTypeId);
      const color=wt?.color||'#4fc3f7';
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','wire'+(conn.id===activeConn?' selected':''));
      path.setAttribute('stroke',color);
      path.setAttribute('data-conn-id',conn.id);
      path.setAttribute('marker-end','url(#arrowEnd)');
      path.setAttribute('d', bezier(p1.x,p1.y,p2.x,p2.y));
      // Hover preview: add 'hovered' class without selecting
      path.addEventListener('mouseenter', ()=>{
        if(conn.id !== WireNotes.getActive()) path.classList.add('hovered');
      });
      path.addEventListener('mouseleave', ()=>path.classList.remove('hovered'));
      path.addEventListener('click', e=>{ e.stopPropagation(); WireNotes.select(conn.id); });
      wiresGroup.appendChild(path);
    });
  }

  return {init,startWire,redraw,redrawWiresOnly,addConnection,removeConnection};
})();

function updateConnCount(){
  document.getElementById('connCount').textContent=`Connessioni: ${State.connections.length}`;
}


// ─── DEVICE MANAGER ─────────────────────────────────────────
// Devices are HW components that can be used as clusters on either side
const DeviceMgr = {

  render(){
    const c=document.getElementById('devContainer');
    if(!c) return;
    if(!State.devices.length){
      c.innerHTML='<p class="wt-empty">Nessun dispositivo. Premi "＋ Nuovo Dispositivo".</p>'; return;
    }
    c.innerHTML='';
    State.devices.forEach(dev=>{
      const usedL = State.clusters.left.some(cl=>cl._deviceId===dev.id);
      const usedR = State.clusters.right.some(cl=>cl._deviceId===dev.id);
      const card=document.createElement('div');
      card.className='dev-card';
      card.innerHTML=`
        <div class="dev-card-header">
          <span class="dev-icon">${dev.icon||'🖥'}</span>
          <span class="dev-name">${_esc(dev.name)}</span>
          ${dev.description?`<span class="dev-desc">${_esc(dev.description)}</span>`:''}
          <div class="dev-header-actions">
            <span class="wt-usage-badge${usedL?' used':''}" title="Usato come Sorgente">${usedL?'✔ Sx':'Sx'}</span>
            <span class="wt-usage-badge${usedR?' used':''}" title="Usato come Destinazione">${usedR?'✔ Dx':'Dx'}</span>
            <button class="btn-wt-edit" onclick="DeviceMgr.addToPanel('${dev.id}','left')" title="Aggiungi a Sorgente">⬅ Usa Sx</button>
            <button class="btn-wt-edit btn-canvas" onclick="DeviceMgr.addToCanvas('${dev.id}')" title="Posiziona nel canvas">📌 Canvas</button>
            <button class="btn-wt-edit" onclick="DeviceMgr.addToPanel('${dev.id}','right')" title="Aggiungi a Destinazione">Usa Dx ➡</button>
            <button class="btn-wt-edit" onclick="DeviceMgr.openEdit('${dev.id}')">✏</button>
            <button class="btn-wt-del"  onclick="DeviceMgr.delete('${dev.id}')">🗑</button>
          </div>
        </div>
        <div class="dev-pins-grid">
          ${dev.pins.map((p,i)=>{
            const wt=State.wireTypes.find(w=>w.id===p.wireTypeId);
            return `<div class="dev-pin-row">
              <button class="dev-pin-edit" onclick="DeviceMgr.openEditPin('${dev.id}','${p.id}')" title="Modifica pin">✏</button>
              <span class="dev-pin-idx">${i+1}</span>
              <span class="dev-pin-color" style="background:${wt?.color||'var(--text-muted)'}"></span>
              <span class="dev-pin-name">${_esc(p.name)}</span>
              <span class="dev-pin-type">${_esc(p.type||'')}</span>
              <span class="dev-pin-desc">${_esc(p.description||'')}</span>
              ${p.note?`<span class="dev-pin-note">${_esc(p.note)}</span>`:''}
              <button class="dev-pin-del" onclick="DeviceMgr.deletePin('${dev.id}','${p.id}')">×</button>
            </div>`;
          }).join('')}
          <button class="dev-addpin-btn" onclick="DeviceMgr.openAddPin('${dev.id}')">＋ Aggiungi pin</button>
        </div>`;
      c.appendChild(card);
    });
  },

  openAdd(){
    Modal.open('Nuovo Dispositivo HW',
      `<div class="modal-row">
         <label>Nome <input id="dv_name" placeholder="es. PLC Siemens S7-1200"/></label>
         <label>Icona emoji <input id="dv_icon" placeholder="🖥"/></label>
       </div>
       <label>Descrizione <input id="dv_desc" placeholder="opzionale"/></label>`,
      ()=>{
        const name=document.getElementById('dv_name').value.trim(); if(!name) return false;
        const dev={id:State.uid('dev'),name,
          icon:document.getElementById('dv_icon').value||'🖥',
          description:document.getElementById('dv_desc').value,
          pins:[]};
        State.devices.push(dev); this.render();
        LVBridge.send('event','deviceAdded',{name});
      },'dv_name');
  },

  openEdit(devId){
    const dev=State.devices.find(d=>d.id===devId); if(!dev) return;
    Modal.open(`Modifica — ${dev.name}`,
      `<div class="modal-row">
         <label>Nome <input id="dv_name" value="${_esc(dev.name)}"/></label>
         <label>Icona <input id="dv_icon" value="${_esc(dev.icon||'')}"/></label>
       </div>
       <label>Descrizione <input id="dv_desc" value="${_esc(dev.description||'')}"/></label>`,
      ()=>{
        const name=document.getElementById('dv_name').value.trim(); if(!name) return false;
        dev.name=name; dev.icon=document.getElementById('dv_icon').value||'🖥';
        dev.description=document.getElementById('dv_desc').value;
        this.render(); ClusterMgr.renderSelectors();
      },'dv_name');
  },

  delete(devId){
    const dev=State.devices.find(d=>d.id===devId); if(!dev) return;
    if(!confirm(`Eliminare il dispositivo "${dev.name}"?
I cluster derivati verranno rimossi.`)) return;
    // remove derived clusters
    ['left','right'].forEach(side=>{
      const removed=State.clusters[side].filter(cl=>cl._deviceId===devId);
      removed.forEach(cl=>{
        const ids=cl.pins.map(p=>p.id);
        State.connections=State.connections.filter(c=>!ids.includes(c.leftId)&&!ids.includes(c.rightId));
      });
      State.clusters[side]=State.clusters[side].filter(cl=>cl._deviceId!==devId);
      if(!State.clusters[side].find(cl=>cl.id===State.active[side]))
        State.active[side]=State.clusters[side][0]?.id||null;
    });
    State.devices=State.devices.filter(d=>d.id!==devId);
    this.render(); ClusterMgr.renderSelectors();
    ClusterMgr.renderList('left'); ClusterMgr.renderList('right'); SVGCanvas.redraw();
  },

  openAddPin(devId){
    const wtOpts=State.wireTypes.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
    Modal.open('Aggiungi Pin al Dispositivo',
      `<div class="modal-row">
         <label>Nome pin <input id="dvp_name" placeholder="es. AI0+"/></label>
         <label>Tipo <select id="dvp_type">${['PIN','TERMINAL','SENSOR','DAQ','PWR','GND','OTHER'].map(t=>`<option>${t}</option>`).join('')}</select></label>
       </div>
       <label>Tipo cavo <select id="dvp_wire"><option value="">— nessuno —</option>${wtOpts}</select></label>
       <div class="modal-row">
         <label>Descrizione <input id="dvp_desc" placeholder="es. Ingresso analogico"/></label>
         <label>Note <input id="dvp_note" placeholder="opzionale"/></label>
       </div>`,
      ()=>{
        const name=document.getElementById('dvp_name').value.trim(); if(!name) return false;
        const dev=State.devices.find(d=>d.id===devId); if(!dev) return false;
        dev.pins.push({id:State.uid('dp'),name,
          type:document.getElementById('dvp_type').value,
          wireTypeId:document.getElementById('dvp_wire').value||undefined,
          description:document.getElementById('dvp_desc').value,
          note:document.getElementById('dvp_note').value});
        this.render();
        // sync any derived clusters
        this._syncDerivedClusters(devId);
      },'dvp_name');
  },

  openEditPin(devId,pinId){
    const dev=State.devices.find(d=>d.id===devId); if(!dev) return;
    const pin=dev.pins.find(p=>p.id===pinId); if(!pin) return;
    const wtOpts=State.wireTypes.map(w=>`<option value="${w.id}"${w.id===pin.wireTypeId?' selected':''}>${w.name}</option>`).join('');
    Modal.open(`Modifica Pin — ${pin.name}`,
      `<div class="modal-row">
         <label>Nome pin <input id="dvp_name" value="${_esc(pin.name)}"/></label>
         <label>Tipo <select id="dvp_type">${['PIN','TERMINAL','SENSOR','DAQ','PWR','GND','OTHER'].map(t=>`<option${t===pin.type?' selected':''}>${t}</option>`).join('')}</select></label>
       </div>
       <label>Tipo cavo <select id="dvp_wire"><option value="">— nessuno —</option>${wtOpts}</select></label>
       <div class="modal-row">
         <label>Descrizione <input id="dvp_desc" value="${_esc(pin.description||'')}"/></label>
         <label>Note <input id="dvp_note" value="${_esc(pin.note||'')}"/></label>
       </div>`,
      ()=>{
        const name=document.getElementById('dvp_name').value.trim(); if(!name) return false;
        pin.name=name; pin.type=document.getElementById('dvp_type').value;
        pin.wireTypeId=document.getElementById('dvp_wire').value||undefined;
        pin.description=document.getElementById('dvp_desc').value;
        pin.note=document.getElementById('dvp_note').value;
        this._syncDerivedClusters(devId); this.render();
      },'dvp_name');
  },

  deletePin(devId,pinId){
    const dev=State.devices.find(d=>d.id===devId); if(!dev) return;
    dev.pins=dev.pins.filter(p=>p.id!==pinId);
    this._syncDerivedClusters(devId);
    this.render();
  },

  // Place device as floating box in center canvas
  addToCanvas(devId){
    const dev=State.devices.find(d=>d.id===devId); if(!dev) return;
    // find SVG container for initial position
    const wrap=document.getElementById('canvasContainer');
    const r=wrap.getBoundingClientRect();
    const x=80+(State.canvasDevices.length%4)*30;
    const y=80+(State.canvasDevices.length%3)*30;
    const cd={id:State.uid('cd'), devId, x, y};
    State.canvasDevices.push(cd);
    CanvasDevices.render();
    document.querySelector('.tab-btn[data-tab="wiring"]').click();
    LVBridge.send('event','deviceOnCanvas',{devId,name:dev.name});
  },

  // Creates/updates a cluster derived from a device on the given side
  addToPanel(devId,side){
    const dev=State.devices.find(d=>d.id===devId); if(!dev) return;
    // check if already there
    const existing=State.clusters[side].find(cl=>cl._deviceId===devId);
    if(existing){
      State.active[side]=existing.id;
      ClusterMgr.renderSelectors(); ClusterMgr.renderList(side);
      // switch tab to wiring
      document.querySelector('.tab-btn[data-tab="wiring"]').click();
      return;
    }
    // clone device pins into a new cluster (shared pin ids)
    const cl={
      id:State.uid('cl'), name:dev.name, icon:dev.icon,
      description:dev.description, _deviceId:devId,
      pins:dev.pins.map(p=>({...p}))
    };
    State.clusters[side].push(cl);
    State.active[side]=cl.id;
    ClusterMgr.renderSelectors(); ClusterMgr.renderList(side);
    this.render();
    document.querySelector('.tab-btn[data-tab="wiring"]').click();
    LVBridge.send('event','deviceAddedToPanel',{devId,side,name:dev.name});
  },

  _syncDerivedClusters(devId){
    const dev=State.devices.find(d=>d.id===devId); if(!dev) return;
    ['left','right'].forEach(side=>{
      const cl=State.clusters[side].find(c=>c._deviceId===devId);
      if(!cl) return;
      cl.name=dev.name; cl.icon=dev.icon; cl.description=dev.description;
      // add new pins not yet present
      dev.pins.forEach(dp=>{
        if(!cl.pins.find(p=>p.id===dp.id)) cl.pins.push({...dp});
      });
      // remove deleted pins
      cl.pins=cl.pins.filter(p=>dev.pins.find(dp=>dp.id===p.id));
      // update existing pin properties
      cl.pins.forEach(p=>{
        const dp=dev.pins.find(d=>d.id===p.id);
        if(dp){ p.name=dp.name; p.type=dp.type; p.wireTypeId=dp.wireTypeId; p.description=dp.description; p.note=dp.note; }
      });
    });
    ClusterMgr.renderList('left'); ClusterMgr.renderList('right'); SVGCanvas.redraw();
  }
};

// ─── WIRING APP ─────────────────────────────────────────────
const WiringApp = {
  clearConnections(){
    if(State.connections.length&&!confirm('Cancellare tutte le connessioni?')) return;
    State.connections=[];
    WireNotes.deselect();
    ClusterMgr.renderList('left'); ClusterMgr.renderList('right');
    SVGCanvas.redraw(); LVBridge.send('event','allCleared',{});
  }
};

// ─── TABLE VIEW ─────────────────────────────────────────────
const TableView = {
  generate(){
    const filterClId=document.getElementById('tableFilter').value;
    let conns=State.connections;
    if(filterClId){
      const cl=[...State.clusters.left,...State.clusters.right].find(c=>c.id===filterClId);
      const ids=cl?cl.pins.map(p=>p.id):[];
      conns=conns.filter(c=>ids.includes(c.leftId)||ids.includes(c.rightId));
    }
    const container=document.getElementById('tableContainer');
    if(!conns.length){container.innerHTML='<p class="hint">Nessun collegamento.</p>';return;}
    let html=`<table class="wiring-table"><thead><tr>
      <th>#</th><th>Etichetta</th><th>Sorgente</th><th>Tipo</th><th>Cluster Sx</th>
      <th>Destinazione</th><th>Tipo</th><th>Cluster Dx</th>
      <th>Tipo Cavo</th><th>Colore</th><th>Sezione</th><th>Tensione</th><th>Lunghezza</th><th>Note</th>
    </tr></thead><tbody>`;
    conns.forEach((c,i)=>{
      const wt=State.wireTypes.find(w=>w.id===c.wireTypeId);
      // resolve cluster name: check panels AND canvas devices
      const _clusterName = (pinId, side) => {
        // side panel clusters
        for(const cl of State.clusters[side])
          if(cl.pins.some(p=>p.id===pinId)) return cl.name;
        // canvas device boxes (any side)
        for(const cd of State.canvasDevices){
          const dev=State.devices.find(d=>d.id===cd.devId); if(!dev) continue;
          if(dev.pins.some(p=>p.id===pinId)) return dev.name+' [canvas]';
        }
        return '—';
      };
      const leftCluster  = _clusterName(c.leftId,  'left');
      const rightCluster = _clusterName(c.rightId, 'right');
      const sw=wt?`<span class="wire-swatch" style="background:${wt.color}"></span>${wt.name}`:'—';
      html+=`<tr><td>${i+1}</td><td>${c.label||''}</td>
        <td>${c.leftName}</td><td>${c.leftType||'—'}</td><td>${leftCluster}</td>
        <td>${c.rightName}</td><td>${c.rightType||'—'}</td><td>${rightCluster}</td>
        <td>${sw}</td><td>${wt?.color||'—'}</td><td>${wt?.section||'—'}</td><td>${wt?.voltage||'—'}</td>
        <td>${c.length||''}</td>
        <td contenteditable="true" style="min-width:120px">${c.note||''}</td></tr>`;
    });
    html+='</tbody></table>';
    container.innerHTML=html;
    container.querySelectorAll('td[contenteditable]').forEach((td,i)=>{
      td.addEventListener('blur',()=>{if(conns[i]) conns[i].note=td.textContent;});
    });
    LVBridge.send('event','tableGenerated',{count:conns.length});
  },
  exportCSV(){
    _askFilename('wiring','csv',fname=>{
      const rows=[['#','Etichetta','Sorgente','Tipo Sx','Cluster Sx','Destinazione','Tipo Dx','Cluster Dx','Tipo Cavo','Colore','Sezione','Tensione','Lunghezza','Note']];
      State.connections.forEach((c,i)=>{
        const wt=State.wireTypes.find(w=>w.id===c.wireTypeId);
        const _cn = (pinId,side) => {
          for(const cl of State.clusters[side]) if(cl.pins.some(p=>p.id===pinId)) return cl.name;
          for(const cd of State.canvasDevices){
            const dev=State.devices.find(d=>d.id===cd.devId); if(!dev) continue;
            if(dev.pins.some(p=>p.id===pinId)) return dev.name+' [canvas]';
          }
          return '';
        };
        rows.push([i+1,c.label||'',c.leftName,c.leftType||'',_cn(c.leftId,'left'),
          c.rightName,c.rightType||'',_cn(c.rightId,'right'),
          wt?.name||'',wt?.color||'',wt?.section||'',wt?.voltage||'',c.length||'',c.note||'']);
      });
      _dl(new Blob([rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n')],{type:'text/csv'}),fname);
    });
  },
  exportJSON(){
    _askFilename('wiring_project','json',fname=>{
      _dl(new Blob([JSON.stringify(ProjectMgr.toJSON(),null,2)],{type:'application/json'}),fname);
    });
  }
};

// ─── IMPORT / EXPORT ────────────────────────────────────────
const ImportExport = {
  importJSON(){ document.getElementById('fileInput').click(); },
  onFileSelected(evt){
    const file=evt.target.files[0]; if(!file) return;
    const r=new FileReader();
    r.onload=e=>{try{ProjectMgr.load(JSON.parse(e.target.result));}catch(err){alert('JSON non valido:\n'+err.message);}};
    r.readAsText(file); evt.target.value='';
  },
  saveProject(){
    _askFilename(State.projectName||'wiring_project','json',fname=>{
      _dl(new Blob([JSON.stringify(ProjectMgr.toJSON(),null,2)],{type:'application/json'}),fname);
    });
  }
};

// ─── FILENAME DIALOG ─────────────────────────────────────────
function _askFilename(def,ext,cb){
  Modal.open('Nome file export',
    `<label>Nome file <input id="m_fname" value="${_esc(def)}"/></label>
     <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Salva come: <strong id="fnPrev">${def}.${ext}</strong></p>`,
    ()=>{ const v=document.getElementById('m_fname').value.trim()||def; cb(v+'.'+ext); },'m_fname');
  setTimeout(()=>{
    const inp=document.getElementById('m_fname'),prev=document.getElementById('fnPrev');
    if(inp&&prev) inp.addEventListener('input',()=>prev.textContent=(inp.value.trim()||def)+'.'+ext);
  },50);
}

function _dl(blob,fname){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=fname; a.click(); URL.revokeObjectURL(a.href);
}

// ─── MODAL ──────────────────────────────────────────────────
const Modal = {
  open(title,bodyHTML,onConfirm,focusId){
    const box=document.getElementById('modalBox'),ov=document.getElementById('modalOverlay');
    box.innerHTML=`<h3>${title}</h3>${bodyHTML}
      <div class="modal-actions">
        <button class="modal-btn-cancel" id="mCancel">Annulla</button>
        <button class="modal-btn-confirm" id="mConfirm">Conferma</button>
      </div>`;
    ov.style.display='flex';
    if(focusId) setTimeout(()=>{ const el=document.getElementById(focusId); if(el){el.focus();el.select();} },60);
    document.getElementById('mCancel').addEventListener('click',()=>ov.style.display='none');
    document.getElementById('mConfirm').addEventListener('click',()=>{ if(onConfirm()!==false) ov.style.display='none'; });
    ov.addEventListener('click',e=>{ if(e.target===ov) ov.style.display='none'; });
    box.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA') document.getElementById('mConfirm').click(); });
  }
};

// ─── TABS ────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab==='wiring') setTimeout(()=>SVGCanvas.redraw(),60);
    LVBridge.send('event','tabChanged',{tab:btn.dataset.tab});
  });
});
document.getElementById('logToggle').addEventListener('change',e=>Logger.setEnabled(e.target.checked));

// ─── HELPERS ────────────────────────────────────────────────
function _contrast(hex){
  if(!hex||!hex.startsWith('#')) return '#fff';
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000>128?'#111':'#fff';
}
function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

// ─── RUNSCRIPT API ───────────────────────────────────────────
window.LV_loadProject = s=>{ try{ProjectMgr.load(JSON.parse(s));}catch(e){Logger.log('err',e);} };
window.LV_getWiring   = ()=>{ const d=State.connections; LVBridge.send('response','wiringData',d); return JSON.stringify(d); };
window.LV_clearConns  = ()=>WiringApp.clearConnections();
window.LV_setLog      = s=>{ try{const{enabled}=JSON.parse(s);Logger.setEnabled(enabled);document.getElementById('logToggle').checked=!!enabled;}catch(e){} };

// ─── BOOT ────────────────────────────────────────────────────
SVGCanvas.init();
LVBridge.init();
LVBridge.send('event','appReady',{version:'4.7'});
