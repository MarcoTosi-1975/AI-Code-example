
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
    State.connections = data.connections||[];
    State.active.left  = State.clusters.left[0]?.id||null;
    State.active.right = State.clusters.right[0]?.id||null;
    ClusterMgr.renderSelectors();
    ClusterMgr.renderList('left');
    ClusterMgr.renderList('right');
    WireTypeMgr.render();
    setTimeout(()=>SVGCanvas.redraw(),100);
    LVBridge.send('event','projectLoaded',{name:State.projectName});
  },
  toJSON(){
    return {project:State.projectName,version:'4.0',
      wireTypes:State.wireTypes,clusters:State.clusters,connections:State.connections};
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
    LVBridge.send('event','wireNoteSaved',{id:connId,note:conn.note,label:conn.label});
  }

  function deselect(){
    activeConnId=null;
    document.querySelectorAll('#wiresGroup .wire.selected').forEach(el=>el.classList.remove('selected'));
    document.getElementById('wn-conn-label').textContent='Clicca su un filo per aggiungere note';
    document.getElementById('wn-conn-label').classList.remove('active');
    document.getElementById('wnBody').innerHTML='<p class="wn-hint">Clicca su un filo nel canvas per selezionarlo e aggiungere note.</p>';
  }

  return {select, save, deselect, getActive:()=>activeConnId};
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

// ─── SVG CANVAS ─────────────────────────────────────────────
const SVGCanvas = (() => {
  let svg,wiresGroup,drawing=false,tempWire=null,startAnchor=null;

  function init(){
    svg=document.getElementById('wiringSvg');
    wiresGroup=document.getElementById('wiresGroup');
    document.addEventListener('mousemove',onMouseMove);
    document.addEventListener('mouseup',onMouseUp);
    window.addEventListener('resize',()=>setTimeout(redraw,60));
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
    const ss=startAnchor.dataset.side,ts=ss==='left'?'right':'left';
    const anchors=document.querySelectorAll(`#panel-${ts} .signal-anchor`);
    for(const a of anchors){
      const r=a.getBoundingClientRect();
      if(e.clientX>=r.left-16&&e.clientX<=r.right+16&&e.clientY>=r.top-16&&e.clientY<=r.bottom+16){
        const lid=ss==='left'?startAnchor.dataset.id:a.dataset.id;
        const rid=ss==='right'?startAnchor.dataset.id:a.dataset.id;
        addConnection(lid,rid); return;
      }
    }
    startAnchor=null;
  }

  function findPin(id){
    for(const s of['left','right'])
      for(const cl of State.clusters[s])
        for(const p of cl.pins) if(p.id===id) return p;
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
      const la=document.querySelector(`#panel-left  .signal-anchor[data-id="${conn.leftId}"]`);
      const ra=document.querySelector(`#panel-right .signal-anchor[data-id="${conn.rightId}"]`);
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
      path.addEventListener('click',()=>WireNotes.select(conn.id));

      // label: prefer conn.label else wire type name
      const midX=(p1.x+p2.x)/2,midY=(p1.y+p2.y)/2;
      const labelText = conn.label || (wt?wt.name.split(' ')[0]:'');
      if(labelText){
        const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
        lbl.setAttribute('x',midX); lbl.setAttribute('y',midY-7);
        lbl.setAttribute('fill',color); lbl.setAttribute('font-size','10');
        lbl.setAttribute('text-anchor','middle'); lbl.style.pointerEvents='none';
        lbl.textContent=labelText;
        wiresGroup.appendChild(lbl);
      }
      // length label
      if(conn.length){
        const ll=document.createElementNS('http://www.w3.org/2000/svg','text');
        ll.setAttribute('x',midX); ll.setAttribute('y',midY+14);
        ll.setAttribute('fill','rgba(255,255,255,.45)'); ll.setAttribute('font-size','9');
        ll.setAttribute('text-anchor','middle'); ll.style.pointerEvents='none';
        ll.textContent=conn.length;
        wiresGroup.appendChild(ll);
      }
      wiresGroup.appendChild(path);
    });
    document.getElementById('dropZoneMsg').style.display=State.connections.length>0?'none':'block';
    updateConnCount();
  }

  return {init,startWire,redraw,addConnection,removeConnection};
})();

function updateConnCount(){
  document.getElementById('connCount').textContent=`Connessioni: ${State.connections.length}`;
}

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
      const lcl=State.clusters.left.find(cl=>cl.pins.some(p=>p.id===c.leftId));
      const rcl=State.clusters.right.find(cl=>cl.pins.some(p=>p.id===c.rightId));
      const sw=wt?`<span class="wire-swatch" style="background:${wt.color}"></span>${wt.name}`:'—';
      html+=`<tr><td>${i+1}</td><td>${c.label||''}</td>
        <td>${c.leftName}</td><td>${c.leftType||'—'}</td><td>${lcl?.name||'—'}</td>
        <td>${c.rightName}</td><td>${c.rightType||'—'}</td><td>${rcl?.name||'—'}</td>
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
        const lcl=State.clusters.left.find(cl=>cl.pins.some(p=>p.id===c.leftId));
        const rcl=State.clusters.right.find(cl=>cl.pins.some(p=>p.id===c.rightId));
        rows.push([i+1,c.label||'',c.leftName,c.leftType||'',lcl?.name||'',
          c.rightName,c.rightType||'',rcl?.name||'',
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
LVBridge.send('event','appReady',{version:'4.0'});
