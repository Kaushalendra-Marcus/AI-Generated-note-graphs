# NoteGraph

A Joplin plugin that transforms any note into an interactive AI-powered knowledge graph.

## What it does

Opens a side panel showing a live knowledge graph of the currently selected note. The graph extracts concepts, entities, events and their relationships — giving you a visual map of everything your note covers.

## Features

- **5 node types** — Topic, Concept, Entity, Event, Attribute (each with distinct colour)
- **4 relationship types** — Hierarchical, Causal, Semantic, Temporal (distinct edge colours and styles)
- **Importance ranking** — node size and border reflect how central a concept is (1–5 scale)
- **5 graph layouts** — Force-directed, Tree, Radial, Circle, Grid
- **Live search** — filter nodes by name; unmatched nodes fade out
- **Rich sidebar** — click any node to see its description, importance, aliases and connections
- **PNG export** — save the graph as a high-resolution image
- **Smart caching** — already-generated graphs load instantly on revisit (10 min TTL, 20 notes)
- **Cross-note links** — detects [[wikilinks]] in notes and renders them as connected nodes
- **Keyboard shortcuts** — +/- zoom, F to fit, Esc to close/clear

## Setup

1. Install the plugin (Tools ? Options ? Plugins ? install from file ? select the .jpl)
2. Go to Tools ? Options ? NoteGraph
3. Paste your [Groq API key](https://console.groq.com) (free, no credit card needed)
4. Open any note and click the graph icon in the toolbar

## Usage

| Action | How |
|---|---|
| Generate graph | Open a note — graph appears automatically |
| Force re-generate | Click ? button |
| Change layout | Use the layout dropdown |
| Zoom | +/- buttons or scroll |
| Fit to screen | ? button or press F |
| Inspect a concept | Click any node |
| Search concepts | Type in the search box |
| Export graph | Click ? PNG |

## Requirements

- Joplin 3.5 or later
- Free Groq API key (get one at console.groq.com)

## License

MIT
