import joplin from 'api';
import { SettingItemType, ToolbarButtonLocation } from 'api/types';
import { extractKnowledgeGraph, KnowledgeGraph, ExtractionStats } from './extractor';

// ── in-memory graph cache (survives note switches, cleared on restart) ──────
interface CacheEntry {
  noteId: string;
  noteTitle: string;
  graph: KnowledgeGraph;
  stats: ExtractionStats;
  bodyHash: number;
  cachedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 20;
const graphCache = new Map<string, CacheEntry>();

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 2000); i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

function getCached(noteId: string, bodyHash: number): CacheEntry | null {
  const entry = graphCache.get(noteId);
  if (!entry) return null;
  if (entry.bodyHash !== bodyHash) return null; // content changed
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null; // expired
  return entry;
}

function putCache(entry: CacheEntry) {
  // evict oldest if full
  if (graphCache.size >= MAX_CACHE_SIZE) {
    const oldest = [...graphCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
    if (oldest) graphCache.delete(oldest[0]);
  }
  graphCache.set(entry.noteId, entry);
}

// ── debounce helper ──────────────────────────────────────────────────────────
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debounce(fn: () => void, ms: number) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, ms);
}

// ── extract cross-note [[wikilinks]] from body ───────────────────────────────
function extractWikiLinks(body: string): string[] {
  const matches = body.match(/\[\[([^\]]+)\]\]/g) || [];
  return matches.map(m => m.slice(2, -2).trim());
}

// ── plugin state ─────────────────────────────────────────────────────────────
let currentNoteId: string | null = null;
let panelVisible = false;
let settings = {
  groqApiKey: '',
  groqModel: 'openai/gpt-oss-120b',
  autoRefresh: true,
  maxConcepts: 20,
};

joplin.plugins.register({
  onStart: async function () {
    // ── settings ──────────────────────────────────────────────────────────
    await joplin.settings.registerSection('notegraph', {
      label: 'NoteGraph',
      iconName: 'fas fa-project-diagram',
    });

    await joplin.settings.registerSettings({
      groqApiKey: {
        value: '',
        type: SettingItemType.String,
        section: 'notegraph',
        public: true,
        label: 'Groq API Key',
        description: 'Get a free key at console.groq.com',
        secure: true,
      },
      groqModel: {
        value: 'openai/gpt-oss-120b',
        type: SettingItemType.String,
        section: 'notegraph',
        public: true,
        label: 'Groq Model',
        description: 'e.g. openai/gpt-oss-120b or llama-3.3-70b-versatile',
      },
      autoRefresh: {
        value: true,
        type: SettingItemType.Bool,
        section: 'notegraph',
        public: true,
        label: 'Auto-refresh on note switch',
        description: 'Automatically generate graph when switching notes',
      },
      maxConcepts: {
        value: 20,
        type: SettingItemType.Int,
        section: 'notegraph',
        public: true,
        label: 'Max concepts to extract',
        description: 'Between 8 and 25 (default 20)',
        minimum: 8,
        maximum: 25,
      },
    });

    // load settings
    settings.groqApiKey = await joplin.settings.value('groqApiKey');
    settings.groqModel = await joplin.settings.value('groqModel');
    settings.autoRefresh = await joplin.settings.value('autoRefresh');
    settings.maxConcepts = await joplin.settings.value('maxConcepts');

    // re-load when user changes settings
    await joplin.settings.onChange(async (event) => {
      if (event.keys.includes('groqApiKey'))
        settings.groqApiKey = await joplin.settings.value('groqApiKey');
      if (event.keys.includes('groqModel'))
        settings.groqModel = await joplin.settings.value('groqModel');
      if (event.keys.includes('autoRefresh'))
        settings.autoRefresh = await joplin.settings.value('autoRefresh');
      if (event.keys.includes('maxConcepts'))
        settings.maxConcepts = await joplin.settings.value('maxConcepts');
    });

    // ── panel ─────────────────────────────────────────────────────────────
    const panelId = await joplin.views.panels.create('noteGraphPanel');
    await joplin.views.panels.setHtml(panelId, buildPanelHtml());
    await joplin.views.panels.addScript(panelId, './webview.js');

    // ── toolbar button ────────────────────────────────────────────────────
    await joplin.commands.register({
      name: 'openNoteGraph',
      label: 'Knowledge Graph',
      iconName: 'fas fa-project-diagram',
      execute: async () => {
        panelVisible = !panelVisible;
        await joplin.views.panels.show(panelId, panelVisible);
        if (panelVisible && currentNoteId) {
          await generateGraph(panelId, currentNoteId, false);
        }
      },
    });

    await joplin.views.toolbarButtons.create(
      'noteGraphBtn',
      'openNoteGraph',
      ToolbarButtonLocation.NoteToolbar
    );

    // ── note selection change ─────────────────────────────────────────────
    await joplin.workspace.onNoteSelectionChange(async () => {
      if (!panelVisible || !settings.autoRefresh) return;

      const note = await joplin.workspace.selectedNote();
      if (!note || note.id === currentNoteId) return;
      currentNoteId = note.id;

      // debounce 400ms so rapid switching doesn't hammer the API
      debounce(() => generateGraph(panelId, note.id, false), 400);
    });

    // ── messages from webview ─────────────────────────────────────────────
    await joplin.views.panels.onMessage(panelId, async (msg) => {
      switch (msg.type) {
        case 'ready': {
          // send current settings to webview
          await joplin.views.panels.postMessage(panelId, {
            type: 'settings',
            apiKey: settings.groqApiKey,
            model: settings.groqModel,
          });
          // generate for current note
          const note = await joplin.workspace.selectedNote();
          if (note) {
            currentNoteId = note.id;
            await generateGraph(panelId, note.id, false);
          }
          break;
        }

        case 'saveSettings': {
          if (msg.apiKey !== undefined) {
            settings.groqApiKey = msg.apiKey;
            await joplin.settings.setValue('groqApiKey', msg.apiKey);
          }
          if (msg.model !== undefined) {
            settings.groqModel = msg.model;
            await joplin.settings.setValue('groqModel', msg.model);
          }
          break;
        }

        case 'refresh': {
          if (msg.apiKey) {
            settings.groqApiKey = msg.apiKey;
            await joplin.settings.setValue('groqApiKey', msg.apiKey);
          }
          if (msg.model) {
            settings.groqModel = msg.model;
            await joplin.settings.setValue('groqModel', msg.model);
          }
          const noteId = currentNoteId || (await joplin.workspace.selectedNote())?.id;
          if (noteId) {
            currentNoteId = noteId;
            await generateGraph(panelId, noteId, true); // force=true skips cache
          }
          break;
        }

        case 'openNote': {
          // user clicked a cross-note link
          if (msg.noteTitle) {
            const results = await joplin.data.get(['search'], {
              query: msg.noteTitle,
              fields: ['id', 'title'],
              limit: 1,
            });
            if (results.items?.length) {
              await joplin.commands.execute('openNote', results.items[0].id);
            }
          }
          break;
        }

        case 'getCacheList': {
          const list = [...graphCache.values()].map(e => ({
            noteId: e.noteId,
            noteTitle: e.noteTitle,
            conceptCount: e.graph.concepts.length,
            cachedAt: e.cachedAt,
          }));
          await joplin.views.panels.postMessage(panelId, {
            type: 'cacheList',
            items: list,
          });
          break;
        }

        case 'loadCached': {
          const entry = graphCache.get(msg.noteId);
          if (entry) {
            await sendGraph(panelId, entry.noteTitle, entry.graph, entry.stats, true);
          }
          break;
        }
      }
    });
  },
});

// ── core graph generation ────────────────────────────────────────────────────
async function generateGraph(panelId: string, noteId: string, force: boolean) {
  try {
    const note = await joplin.data.get(['notes', noteId], {
      fields: ['id', 'title', 'body'],
    });

    const title = note.title || 'Untitled';
    const body = (note.body || '').trim();

    if (body.length < 20) {
      await joplin.views.panels.postMessage(panelId, {
        type: 'empty',
        noteTitle: title,
        message: 'Note is too short to generate a knowledge graph.',
      });
      return;
    }

    const bodyHash = hashString(body);

    // cache hit
    if (!force) {
      const cached = getCached(noteId, bodyHash);
      if (cached) {
        await sendGraph(panelId, cached.noteTitle, cached.graph, cached.stats, true);
        return;
      }
    }

    if (!settings.groqApiKey) {
      await joplin.views.panels.postMessage(panelId, {
        type: 'error',
        message: 'Groq API key not set. Go to Tools → Options → NoteGraph.',
      });
      return;
    }

    // notify webview: loading
    await joplin.views.panels.postMessage(panelId, {
      type: 'loading',
      noteTitle: title,
      message: 'Extracting knowledge graph…',
    });

    // extract cross-note wikilinks
    const wikiLinks = extractWikiLinks(body);

    const { graph, stats } = await extractKnowledgeGraph(
      title,
      body,
      settings.groqApiKey,
      settings.groqModel
    );

    // attach wikilinks as special cross-note nodes if present
    if (wikiLinks.length > 0) {
      const linkIds = new Set<string>();
      wikiLinks.forEach((link, i) => {
        if (linkIds.has(link)) return;
        linkIds.add(link);
        const id = `wl_${i}`;
        graph.concepts.push({
          id,
          label: link,
          type: 'entity',
          importance: 2,
          description: `Linked note: [[${link}]]`,
          parentId: null,
          aliases: [],
        });
        graph.relationships.push({
          source: graph.concepts[0]?.id || id,
          target: id,
          label: 'links to',
          relType: 'semantic',
          strength: 2,
        });
      });
    }

    const entry: CacheEntry = {
      noteId,
      noteTitle: title,
      graph,
      stats,
      bodyHash,
      cachedAt: Date.now(),
    };
    putCache(entry);

    await sendGraph(panelId, title, graph, stats, false);
  } catch (err) {
    await joplin.views.panels.postMessage(panelId, {
      type: 'error',
      message: err.message || 'Unknown error',
    });
  }
}

async function sendGraph(
  panelId: string,
  noteTitle: string,
  graph: KnowledgeGraph,
  stats: ExtractionStats,
  fromCache: boolean
) {
  await joplin.views.panels.postMessage(panelId, {
    type: 'graphData',
    noteTitle,
    concepts: graph.concepts,
    relationships: graph.relationships,
    summary: graph.summary || '',
    stats,
    fromCache,
  });
}

// ── minimal panel HTML shell (real UI is built in webview.js) ────────────────
function buildPanelHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden;
      background-color: var(--joplin-background-color);
      color: var(--joplin-color);
      font-family: var(--joplin-font-family);
      font-size: var(--joplin-font-size); }
  </style>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
}