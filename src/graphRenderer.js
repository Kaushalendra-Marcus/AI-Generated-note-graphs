/* global webviewApi */
'use strict';

const cytoscape = require('cytoscape');

(function () {

  // ── colour palette ─────────────────────────────────────────────────────────
  const NODE_COLORS = {
    topic:     '#4a9eff',
    concept:   '#5cb85c',
    entity:    '#e8a045',
    event:     '#e05c5c',
    attribute: '#9b59b6',
  };

  const REL_COLORS = {
    hierarchical: '#4a9eff',
    causal:       '#e05c5c',
    semantic:     '#aaaaaa',
    temporal:     '#e8a045',
    attribute:    '#9b59b6',
  };

  const REL_STYLE = {
    hierarchical: 'solid',
    causal:       'solid',
    semantic:     'dashed',
    temporal:     'dotted',
    attribute:    'dashed',
  };

  // ── build the UI shell ─────────────────────────────────────────────────────
  document.getElementById('root').innerHTML = `
    <div id="shell">

      <!-- TOOLBAR -->
      <div id="toolbar">
        <span id="note-title">No note selected</span>

        <div id="toolbar-controls">
          <input type="text" id="search-box" placeholder="Search concepts…" />

          <select id="layout-select" title="Graph layout">
            <option value="cose">Force</option>
            <option value="breadthfirst">Tree</option>
            <option value="concentric">Radial</option>
            <option value="circle">Circle</option>
            <option value="grid">Grid</option>
          </select>

          <div class="btn-group">
            <button id="zoom-in"  title="Zoom in">+</button>
            <button id="zoom-out" title="Zoom out">−</button>
            <button id="fit-btn"  title="Fit graph">⊡</button>
          </div>

          <button id="export-btn" title="Export as PNG">↓ PNG</button>
          <button id="refresh-btn" title="Re-generate graph">↻</button>
        </div>
      </div>

      <!-- SETTINGS BAR (hidden until user opens) -->
      <div id="settings-bar" class="hidden">
        <label>Groq API Key
          <input type="password" id="api-key-input" placeholder="gsk_…" />
        </label>
        <label>Model
          <input type="text" id="model-input" placeholder="openai/gpt-oss-120b" style="width:190px"/>
        </label>
        <button id="save-settings-btn">Save</button>
        <button id="close-settings-btn">✕</button>
      </div>

      <!-- STATUS -->
      <div id="status-bar">
        <span id="status-text">Open a note to generate its knowledge graph</span>
        <div id="status-right">
          <span id="cache-badge" class="hidden badge">cached</span>
          <button id="settings-toggle" title="API settings">⚙</button>
        </div>
      </div>

      <!-- SUMMARY -->
      <div id="summary-bar" class="hidden"></div>

      <!-- MAIN AREA -->
      <div id="main">
        <div id="cy"></div>

        <!-- LEGEND -->
        <div id="legend">
          <div class="legend-title">Node type</div>
          <div class="legend-row"><span class="dot" style="background:#4a9eff"></span>Topic</div>
          <div class="legend-row"><span class="dot" style="background:#5cb85c"></span>Concept</div>
          <div class="legend-row"><span class="dot" style="background:#e8a045"></span>Entity</div>
          <div class="legend-row"><span class="dot" style="background:#e05c5c"></span>Event</div>
          <div class="legend-row"><span class="dot" style="background:#9b59b6"></span>Attribute</div>
          <div class="legend-title" style="margin-top:8px">Edge type</div>
          <div class="legend-row"><span class="line solid"  style="background:#4a9eff"></span>Hierarchical</div>
          <div class="legend-row"><span class="line solid"  style="background:#e05c5c"></span>Causal</div>
          <div class="legend-row"><span class="line dashed" style="background:#aaaaaa"></span>Semantic</div>
          <div class="legend-row"><span class="line dotted" style="background:#e8a045"></span>Temporal</div>
        </div>

        <!-- STATS -->
        <div id="stats-panel">
          <div class="stat-item" id="stat-nodes">0 concepts</div>
          <div class="stat-item" id="stat-edges">0 links</div>
          <div class="stat-item" id="stat-time">–</div>
        </div>

        <!-- SIDEBAR -->
        <div id="sidebar" class="hidden">
          <div id="sidebar-header">
            <span id="sb-label">Concept</span>
            <button id="sb-close">✕</button>
          </div>
          <div id="sidebar-body">
            <div id="sb-type-badge"></div>
            <div id="sb-importance"></div>
            <div id="sb-description"></div>
            <div id="sb-aliases" class="hidden"></div>
            <div class="sb-section-title">Connections</div>
            <div id="sb-connections"></div>
          </div>
        </div>
      </div>

    </div>

    <style>
      * { margin:0; padding:0; box-sizing:border-box; }

      #shell {
        display: flex;
        flex-direction: column;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        background: var(--joplin-background-color);
        color: var(--joplin-color);
        font-family: var(--joplin-font-family);
        font-size: var(--joplin-font-size, 13px);
      }

      /* TOOLBAR */
      #toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: var(--joplin-background-color2);
        border-bottom: 1px solid var(--joplin-divider-color);
        flex-shrink: 0;
        flex-wrap: wrap;
      }

      #note-title {
        font-size: 12px;
        font-weight: 600;
        flex: 1;
        min-width: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #toolbar-controls {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
      }

      #search-box {
        width: 130px;
        padding: 3px 7px;
        border-radius: 3px;
        border: 1px solid var(--joplin-divider-color);
        background: var(--joplin-background-color);
        color: var(--joplin-color);
        font-size: 11px;
      }

      #search-box:focus { outline: 1px solid #4a9eff; }

      select, button {
        background: var(--joplin-background-color3, var(--joplin-background-color2));
        border: 1px solid var(--joplin-divider-color);
        color: var(--joplin-color);
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
        padding: 3px 7px;
      }

      select:hover, button:hover {
        background: var(--joplin-background-color-hover, #444);
      }

      .btn-group { display: flex; gap: 2px; }
      .btn-group button { padding: 3px 8px; }

      /* SETTINGS BAR */
      #settings-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 10px;
        background: var(--joplin-background-color2);
        border-bottom: 1px solid var(--joplin-divider-color);
        flex-shrink: 0;
        flex-wrap: wrap;
        font-size: 11px;
      }

      #settings-bar label {
        display: flex;
        align-items: center;
        gap: 5px;
      }

      #settings-bar input {
        padding: 3px 7px;
        border-radius: 3px;
        border: 1px solid var(--joplin-divider-color);
        background: var(--joplin-background-color);
        color: var(--joplin-color);
        font-size: 11px;
        width: 170px;
      }

      /* STATUS */
      #status-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 3px 10px;
        font-size: 11px;
        color: var(--joplin-color-faded);
        background: var(--joplin-background-color2);
        border-bottom: 1px solid var(--joplin-divider-color);
        flex-shrink: 0;
        min-height: 24px;
      }

      #status-right { display: flex; align-items: center; gap: 6px; }

      #settings-toggle {
        background: none;
        border: none;
        font-size: 13px;
        cursor: pointer;
        padding: 0 3px;
        color: var(--joplin-color-faded);
      }

      .badge {
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 8px;
        background: #5cb85c;
        color: #fff;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      /* SUMMARY */
      #summary-bar {
        padding: 5px 12px;
        font-size: 11px;
        font-style: italic;
        color: var(--joplin-color-faded);
        background: var(--joplin-background-color);
        border-bottom: 1px solid var(--joplin-divider-color);
        flex-shrink: 0;
      }

      /* MAIN */
      #main {
        flex: 1;
        position: relative;
        overflow: hidden;
        min-height: 0;
        display: flex;
      }

      #cy { flex: 1; min-width: 0; }

      /* LEGEND */
      #legend {
        position: absolute;
        bottom: 10px;
        left: 10px;
        background: var(--joplin-background-color2);
        border: 1px solid var(--joplin-divider-color);
        border-radius: 4px;
        padding: 7px 10px;
        font-size: 10px;
        color: var(--joplin-color-faded);
        z-index: 10;
        pointer-events: none;
        line-height: 1.9;
      }

      .legend-title { font-weight: 700; font-size: 9px; text-transform: uppercase;
                      letter-spacing: .06em; color: var(--joplin-color-faded); }
      .legend-row { display: flex; align-items: center; gap: 6px; }

      .dot  { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
      .line { width: 16px; height: 2px; flex-shrink: 0; }
      .line.dashed { background: repeating-linear-gradient(to right, var(--c, #aaa) 0 4px, transparent 4px 7px) !important; }
      .line.dotted { background: repeating-linear-gradient(to right, var(--c, #e8a045) 0 2px, transparent 2px 5px) !important; }

      /* STATS */
      #stats-panel {
        position: absolute;
        bottom: 10px;
        right: 10px;
        display: flex;
        gap: 8px;
        z-index: 10;
        pointer-events: none;
      }

      .stat-item {
        background: var(--joplin-background-color2);
        border: 1px solid var(--joplin-divider-color);
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 10px;
        color: var(--joplin-color-faded);
      }

      /* SIDEBAR */
      #sidebar {
        width: 230px;
        flex-shrink: 0;
        border-left: 1px solid var(--joplin-divider-color);
        background: var(--joplin-background-color2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: width 0.15s;
      }

      #sidebar.hidden { width: 0; border-left: none; }

      #sidebar-header {
        padding: 8px 10px;
        border-bottom: 1px solid var(--joplin-divider-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }

      #sb-label {
        font-weight: 700;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      #sb-close {
        background: none;
        border: none;
        font-size: 13px;
        cursor: pointer;
        padding: 0 2px;
        color: var(--joplin-color-faded);
        flex-shrink: 0;
      }

      #sidebar-body {
        padding: 10px;
        overflow-y: auto;
        flex: 1;
        font-size: 12px;
        line-height: 1.5;
      }

      #sb-type-badge {
        display: inline-block;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: .06em;
        padding: 1px 7px;
        border-radius: 8px;
        margin-bottom: 8px;
        font-weight: 600;
      }

      #sb-importance {
        font-size: 11px;
        color: var(--joplin-color-faded);
        margin-bottom: 6px;
      }

      #sb-description {
        font-size: 11px;
        margin-bottom: 10px;
        line-height: 1.6;
        color: var(--joplin-color);
        border-left: 2px solid var(--joplin-divider-color);
        padding-left: 8px;
      }

      #sb-aliases {
        font-size: 10px;
        color: var(--joplin-color-faded);
        margin-bottom: 10px;
      }

      .sb-section-title {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: .07em;
        font-weight: 700;
        color: var(--joplin-color-faded);
        margin-bottom: 5px;
        margin-top: 4px;
      }

      #sb-connections { font-size: 11px; }

      .conn-item {
        padding: 5px 0;
        border-bottom: 1px solid var(--joplin-divider-color);
        line-height: 1.4;
      }

      .conn-dir { font-size: 9px; text-transform: uppercase; letter-spacing:.04em;
                  color: var(--joplin-color-faded); margin-right: 3px; }

      .conn-rel {
        display: inline-block;
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 8px;
        border: 1px solid var(--joplin-divider-color);
        color: var(--joplin-color-faded);
        margin-left: 4px;
      }

      /* UTILITY */
      .hidden { display: none !important; }
    </style>
  `;

  // ── element refs ───────────────────────────────────────────────────────────
  const noteTitleEl   = document.getElementById('note-title');
  const statusText    = document.getElementById('status-text');
  const cacheBadge    = document.getElementById('cache-badge');
  const summaryBar    = document.getElementById('summary-bar');
  const settingsBar   = document.getElementById('settings-bar');
  const searchBox     = document.getElementById('search-box');
  const layoutSelect  = document.getElementById('layout-select');
  const apiKeyInput   = document.getElementById('api-key-input');
  const modelInput    = document.getElementById('model-input');
  const sidebar       = document.getElementById('sidebar');

  let cy = null;
  let allConcepts = [];
  let allRelationships = [];

  // ── toolbar interactions ───────────────────────────────────────────────────
  document.getElementById('settings-toggle').addEventListener('click', () => {
    settingsBar.classList.toggle('hidden');
  });

  document.getElementById('close-settings-btn').addEventListener('click', () => {
    settingsBar.classList.add('hidden');
  });

  document.getElementById('save-settings-btn').addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim();
    webviewApi.postMessage({ type: 'saveSettings', apiKey, model });
    settingsBar.classList.add('hidden');
    setStatus('Settings saved.');
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    webviewApi.postMessage({
      type: 'refresh',
      apiKey: apiKeyInput.value.trim() || undefined,
      model: modelInput.value.trim() || undefined,
    });
  });

  document.getElementById('fit-btn').addEventListener('click', () => {
    if (cy) cy.fit(undefined, 40);
  });

  document.getElementById('zoom-in').addEventListener('click', () => {
    if (cy) cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  });

  document.getElementById('zoom-out').addEventListener('click', () => {
    if (cy) cy.zoom({ level: cy.zoom() * 0.8, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    if (!cy) return;
    const png = cy.png({ scale: 2, full: true, bg: isDark() ? '#1e1e1e' : '#ffffff' });
    const a = document.createElement('a');
    a.href = png;
    a.download = (noteTitleEl.textContent || 'graph') + '.png';
    a.click();
  });

  document.getElementById('sb-close').addEventListener('click', closeSidebar);

  layoutSelect.addEventListener('change', () => {
    if (cy && allConcepts.length) applyLayout(layoutSelect.value);
  });

  // search — live filter
  let searchTimer = null;
  searchBox.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySearch(searchBox.value.trim()), 150);
  });

  // keyboard shortcut: Escape clears search / closes sidebar
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!sidebar.classList.contains('hidden')) { closeSidebar(); return; }
      if (searchBox.value) { searchBox.value = ''; applySearch(''); }
    }
    if (e.key === '+' || e.key === '=') { document.getElementById('zoom-in').click(); }
    if (e.key === '-') { document.getElementById('zoom-out').click(); }
    if (e.key === 'f' || e.key === 'F') { document.getElementById('fit-btn').click(); }
  });

  // ── theme helpers ──────────────────────────────────────────────────────────
  function isDark() {
    const bg = getComputedStyle(document.body)
      .getPropertyValue('--joplin-background-color').trim();
    if (!bg) return true;
    const c = bg.replace('#', '');
    if (c.length === 6) {
      const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
      return (r*299 + g*587 + b*114)/1000 < 128;
    }
    return true;
  }

  function themeColors() {
    const dark = isDark();
    return {
      dark,
      label:     dark ? '#dddddd' : '#222222',
      edgeLabel: dark ? '#999999' : '#666666',
      nodeBg:    dark ? '#2a2a2a' : '#f5f5f5',
      bg:        dark ? '#1e1e1e' : '#ffffff',
    };
  }

  // ── status helpers ─────────────────────────────────────────────────────────
  function setStatus(msg) { statusText.textContent = msg; }

  // ── importance → node size ─────────────────────────────────────────────────
  function nodeSize(importance) {
    return 18 + importance * 6; // 1→24, 5→48
  }

  // ── build cytoscape graph ──────────────────────────────────────────────────
  function buildGraph(concepts, relationships) {
    if (cy) { cy.destroy(); cy = null; }

    allConcepts = concepts;
    allRelationships = relationships;

    const tc = themeColors();
    const elements = [];

    for (const c of concepts) {
      elements.push({
        data: {
          id: c.id,
          label: c.label,
          type: c.type || 'concept',
          importance: c.importance || 3,
          description: c.description || '',
          aliases: c.aliases || [],
          parentId: c.parentId || null,
        },
      });
    }

    for (const r of relationships) {
      elements.push({
        data: {
          id: `${r.source}__${r.target}__${r.label}`,
          source: r.source,
          target: r.target,
          label: r.label,
          relType: r.relType || 'semantic',
          strength: r.strength || 2,
        },
      });
    }

    cy = cytoscape({
      container: document.getElementById('cy'),
      elements,
      layout: getLayoutConfig(layoutSelect.value),
      style: buildStylesheet(tc),
    });

    // node click → open sidebar
    cy.on('tap', 'node', evt => {
      const node = evt.target;
      openSidebar(node);

      cy.elements().addClass('faded');
      node.removeClass('faded').addClass('highlighted');
      node.connectedEdges().removeClass('faded').addClass('highlighted');
      node.neighborhood('node').removeClass('faded').addClass('highlighted');
    });

    // background tap → deselect
    cy.on('tap', evt => {
      if (evt.target === cy) closeSidebar();
    });

    // node hover → tooltip via title
    cy.on('mouseover', 'node', evt => {
      evt.target.scratch('_origLabel', evt.target.data('label'));
    });
  }

  function buildStylesheet(tc) {
    return [
      {
        selector: 'node',
        style: {
          'background-color': ele => NODE_COLORS[ele.data('type')] || '#aaa',
          'width':  ele => nodeSize(ele.data('importance')),
          'height': ele => nodeSize(ele.data('importance')),
          'label':  'data(label)',
          'font-size': ele => (ele.data('importance') >= 4 ? '11px' : '9px'),
          'font-weight': ele => (ele.data('importance') >= 4 ? '700' : '400'),
          'color': tc.label,
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 4,
          'text-max-width': '110px',
          'text-wrap': 'ellipsis',
          'border-width': ele => (ele.data('importance') === 5 ? 3 : 1.5),
          'border-color': ele => (ele.data('importance') === 5 ? '#ffcc00' : tc.bg),
          'transition-property': 'opacity, border-width',
          'transition-duration': '0.15s',
        },
      },
      {
        selector: 'edge',
        style: {
          'line-color': ele => REL_COLORS[ele.data('relType')] || '#aaa',
          'width': ele => 0.8 + (ele.data('strength') || 2) * 0.6,
          'line-style': ele => REL_STYLE[ele.data('relType')] || 'solid',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': ele => REL_COLORS[ele.data('relType')] || '#aaa',
          'arrow-scale': 0.7,
          'label': 'data(label)',
          'font-size': '9px',
          'color': tc.edgeLabel,
          'text-rotation': 'autorotate',
          'text-margin-y': -6,
          'text-background-color': tc.bg,
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
          'opacity': 0.75,
          'transition-property': 'opacity, width',
          'transition-duration': '0.15s',
        },
      },
      { selector: '.faded',       style: { opacity: 0.05 } },
      { selector: 'node.highlighted', style: { opacity: 1, 'border-width': 3, 'border-color': '#ffcc00' } },
      { selector: 'edge.highlighted', style: { opacity: 1, width: 2.5 } },
      { selector: '.search-match',    style: { opacity: 1, 'border-width': 2, 'border-color': '#ffcc00' } },
      { selector: '.search-dim',      style: { opacity: 0.08 } },
    ];
  }

  // ── layout configs ─────────────────────────────────────────────────────────
  function getLayoutConfig(name) {
    switch (name) {
      case 'breadthfirst':
        return { name: 'breadthfirst', directed: true, padding: 40,
                 spacingFactor: 1.4, animate: true, animationDuration: 400 };
      case 'concentric':
        return { name: 'concentric', padding: 40, animate: true, animationDuration: 400,
                 concentric: node => node.data('importance') || 1,
                 levelWidth: () => 2, spacingFactor: 1.4 };
      case 'circle':
        return { name: 'circle', padding: 40, animate: true, animationDuration: 400 };
      case 'grid':
        return { name: 'grid', padding: 40, animate: true, animationDuration: 400 };
      default: // cose
        return { name: 'cose', animate: true, animationDuration: 500,
                 nodeRepulsion: () => 10000, idealEdgeLength: () => 100,
                 edgeElasticity: () => 45, gravity: 0.5, numIter: 1000,
                 fit: true, padding: 50, randomize: false };
    }
  }

  function applyLayout(name) {
    if (!cy) return;
    cy.layout(getLayoutConfig(name)).run();
  }

  // ── search / filter ────────────────────────────────────────────────────────
  function applySearch(query) {
    if (!cy) return;
    cy.elements().removeClass('search-match search-dim faded highlighted');

    if (!query) return;

    const q = query.toLowerCase();
    const matched = cy.nodes().filter(n => n.data('label').toLowerCase().includes(q));
    const unmatched = cy.nodes().not(matched);

    matched.addClass('search-match');
    unmatched.addClass('search-dim');
    cy.edges().addClass('search-dim');

    // also show edges between matched nodes
    matched.edgesWith(matched).removeClass('search-dim');

    if (matched.length) cy.fit(matched, 80);
  }

  // ── sidebar ────────────────────────────────────────────────────────────────
  function openSidebar(node) {
    const label = node.data('label');
    const type = node.data('type') || 'concept';
    const importance = node.data('importance') || 3;
    const description = node.data('description') || '';
    const aliases = node.data('aliases') || [];
    const nodeId = node.id();

    document.getElementById('sb-label').textContent = label;

    const badge = document.getElementById('sb-type-badge');
    badge.textContent = type;
    badge.style.background = NODE_COLORS[type] || '#aaa';
    badge.style.color = '#fff';

    document.getElementById('sb-importance').textContent =
      '★'.repeat(importance) + '☆'.repeat(5 - importance) + '  Importance: ' + importance + '/5';

    document.getElementById('sb-description').textContent = description || '—';

    const aliasEl = document.getElementById('sb-aliases');
    if (aliases.length) {
      aliasEl.classList.remove('hidden');
      aliasEl.textContent = 'Also known as: ' + aliases.join(', ');
    } else {
      aliasEl.classList.add('hidden');
    }

    // connections list
    const conns = [];
    node.connectedEdges().forEach(edge => {
      const isSrc = edge.data('source') === nodeId;
      const other = isSrc
        ? cy.getElementById(edge.data('target'))
        : cy.getElementById(edge.data('source'));
      const dir = isSrc ? '→' : '←';
      const relType = edge.data('relType') || 'semantic';
      const color = REL_COLORS[relType] || '#aaa';
      conns.push(
        `<div class="conn-item">
          <span class="conn-dir">${dir}</span>
          <strong>${other.data('label')}</strong>
          <span class="conn-rel" style="border-color:${color};color:${color}">${edge.data('label')}</span>
        </div>`
      );
    });

    document.getElementById('sb-connections').innerHTML =
      conns.length
        ? conns.join('')
        : '<span style="color:var(--joplin-color-faded)">No connections</span>';

    sidebar.classList.remove('hidden');
  }

  function closeSidebar() {
    sidebar.classList.add('hidden');
    if (cy) cy.elements().removeClass('faded highlighted search-match search-dim');
    searchBox.value = '';
  }

  // ── stats panel ────────────────────────────────────────────────────────────
  function updateStats(conceptCount, relCount, durationMs, fromCache) {
    document.getElementById('stat-nodes').textContent = conceptCount + ' concepts';
    document.getElementById('stat-edges').textContent = relCount + ' links';
    document.getElementById('stat-time').textContent =
      fromCache ? 'from cache' : durationMs + ' ms';
  }

  // ── message handler ────────────────────────────────────────────────────────
  webviewApi.onMessage(raw => {
    const msg = raw.message || raw;

    switch (msg.type) {
      case 'settings':
        if (msg.apiKey) apiKeyInput.value = msg.apiKey;
        if (msg.model) modelInput.value = msg.model;
        break;

      case 'loading':
        noteTitleEl.textContent = msg.noteTitle || '';
        setStatus(msg.message || 'Extracting knowledge graph…');
        cacheBadge.classList.add('hidden');
        summaryBar.classList.add('hidden');
        if (cy) { cy.destroy(); cy = null; }
        document.getElementById('stat-nodes').textContent = '–';
        document.getElementById('stat-edges').textContent = '–';
        document.getElementById('stat-time').textContent = '–';
        break;

      case 'graphData': {
        noteTitleEl.textContent = msg.noteTitle || '';

        if (msg.summary) {
          summaryBar.textContent = msg.summary;
          summaryBar.classList.remove('hidden');
        } else {
          summaryBar.classList.add('hidden');
        }

        if (msg.fromCache) cacheBadge.classList.remove('hidden');
        else cacheBadge.classList.add('hidden');

        buildGraph(msg.concepts || [], msg.relationships || []);

        const s = msg.stats || {};
        updateStats(
          (msg.concepts || []).length,
          (msg.relationships || []).length,
          s.durationMs,
          msg.fromCache
        );

        const model = s.model ? ` · ${s.model}` : '';
        setStatus(`${(msg.concepts||[]).length} concepts · ${(msg.relationships||[]).length} links${model}`);
        break;
      }

      case 'empty':
        noteTitleEl.textContent = msg.noteTitle || '';
        setStatus(msg.message || 'Note is too short.');
        cacheBadge.classList.add('hidden');
        summaryBar.classList.add('hidden');
        if (cy) { cy.destroy(); cy = null; }
        break;

      case 'error':
        setStatus('⚠ ' + (msg.message || 'Unknown error'));
        cacheBadge.classList.add('hidden');
        break;
    }
  });

  // signal ready
  webviewApi.postMessage({ type: 'ready' });

})();