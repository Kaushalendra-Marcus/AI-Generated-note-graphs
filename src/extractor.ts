export interface Concept {
  id: string;
  label: string;
  type: 'topic' | 'entity' | 'concept' | 'event' | 'attribute';
  importance: 1 | 2 | 3 | 4 | 5; // 5 = most important
  description: string;
  parentId?: string | null;
  aliases?: string[];
}

export interface Relationship {
  source: string;
  target: string;
  label: string;
  relType: 'hierarchical' | 'causal' | 'semantic' | 'temporal' | 'attribute';
  strength: 1 | 2 | 3; // 3 = strongest
}

export interface KnowledgeGraph {
  concepts: Concept[];
  relationships: Relationship[];
  summary?: string;
}

export interface ExtractionStats {
  inputChars: number;
  conceptCount: number;
  relationshipCount: number;
  durationMs: number;
  model: string;
}

const SYSTEM_PROMPT = `You are an expert knowledge graph extractor. Given a note, deeply analyze its content and extract a rich, hierarchical knowledge graph.

Return ONLY a valid JSON object — no markdown, no backticks, no explanation:
{
  "summary": "One sentence describing what this note is about",
  "concepts": [
    {
      "id": "c1",
      "label": "Machine Learning",
      "type": "topic",
      "importance": 5,
      "description": "Brief one-line description of this concept in context",
      "parentId": null,
      "aliases": ["ML"]
    },
    {
      "id": "c2",
      "label": "Supervised Learning",
      "type": "concept",
      "importance": 4,
      "description": "Learning from labeled training data",
      "parentId": "c1",
      "aliases": []
    }
  ],
  "relationships": [
    {
      "source": "c1",
      "target": "c2",
      "label": "includes",
      "relType": "hierarchical",
      "strength": 3
    },
    {
      "source": "c2",
      "target": "c3",
      "label": "causes",
      "relType": "causal",
      "strength": 2
    }
  ]
}

TYPE RULES:
- topic: broad subject area (e.g. Machine Learning, Economics)
- concept: specific idea or theory (e.g. Gradient Descent, Inflation)
- entity: named person, org, place, product (e.g. OpenAI, Python, London)
- event: something that happens (e.g. Training, Deployment, Crash)
- attribute: property or characteristic (e.g. Accuracy, Complexity)

IMPORTANCE (1-5):
- 5: Central theme of the note — always the main topic
- 4: Major supporting concept — directly related to main theme
- 3: Important concept — referenced multiple times
- 2: Supporting detail — mentioned but not core
- 1: Minor reference — barely touched on

RELATIONSHIP TYPES:
- hierarchical: parent/child, contains, is-a, part-of
- causal: causes, enables, prevents, leads-to
- semantic: relates-to, similar-to, contrasts-with, extends
- temporal: precedes, follows, during, triggers
- attribute: has-property, characterized-by, defined-by

RELATIONSHIP STRENGTH (1-3):
- 3: Strong, direct, explicitly stated
- 2: Medium, implied or mentioned once
- 1: Weak, inferred or tangential

RULES:
- Extract 8 to 25 concepts — quality over quantity
- Always include a concept with importance=5 (the main topic)
- parentId must reference an existing concept id, or null
- Build a hierarchy — not everything at the root level
- relationship label: short verb phrase (1-4 words)
- Aliases: only add if the note uses alternate names
- Return ONLY the JSON object`;

export function cleanNoteBody(body: string): string {
  return body
    .replace(/!\[.*?\]\(:\/[a-f0-9]{32}\)/g, '') // remove joplin image refs
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links → text
    .replace(/```[\s\S]*?```/gm, '[code block]') // code blocks → placeholder
    .replace(/`[^`]+`/g, '') // inline code
    .replace(/^\s*#{1,6}\s/gm, '') // headings
    .replace(/^\s*[-*+]\s/gm, '') // list bullets
    .replace(/^\s*\d+\.\s/gm, '') // numbered lists
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1') // strikethrough
    .replace(/^>\s/gm, '') // blockquotes
    .replace(/\|[^\n]+\|/gm, '') // tables
    .replace(/[-]{3,}/g, '') // horizontal rules
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // wiki links
    .replace(/\s{2,}/g, ' ') // multiple spaces
    .replace(/\n{3,}/g, '\n\n') // multiple newlines
    .trim()
    .slice(0, 8000);
}

export async function extractKnowledgeGraph(
  title: string,
  body: string,
  apiKey: string,
  model = 'openai/gpt-oss-120b'
): Promise<{ graph: KnowledgeGraph; stats: ExtractionStats }> {
  const cleaned = cleanNoteBody(body);
  const content = `Note title: ${title}\n\nNote content:\n${cleaned}`;
  const t0 = Date.now();

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg =
      err?.error?.message ||
      `Groq API error ${response.status}: ${response.statusText}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';

  // strip any accidental markdown fences
  const cleaned2 = raw.replace(/```json|```/g, '').trim();

  let parsed: KnowledgeGraph;
  try {
    parsed = JSON.parse(cleaned2);
  } catch {
    throw new Error('Could not parse Groq response as JSON. Try again.');
  }

  if (!Array.isArray(parsed.concepts) || !Array.isArray(parsed.relationships)) {
    throw new Error('Invalid graph structure returned by AI. Try again.');
  }

  // normalise fields — fill in defaults if AI missed them
  parsed.concepts = parsed.concepts.map((c, i) => ({
    id: c.id || `c${i + 1}`,
    label: c.label || 'Unknown',
    type: c.type || 'concept',
    importance: (c.importance as number) || 3,
    description: c.description || '',
    parentId: c.parentId || null,
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
  })) as Concept[];

  parsed.relationships = parsed.relationships.map((r, i) => ({
    source: r.source,
    target: r.target,
    label: r.label || 'relates to',
    relType: r.relType || 'semantic',
    strength: (r.strength as number) || 2,
  })) as Relationship[];

  // remove relationships pointing to non-existent nodes
  const ids = new Set(parsed.concepts.map(c => c.id));
  parsed.relationships = parsed.relationships.filter(
    r => ids.has(r.source) && ids.has(r.target) && r.source !== r.target
  );

  return {
    graph: parsed,
    stats: {
      inputChars: cleaned.length,
      conceptCount: parsed.concepts.length,
      relationshipCount: parsed.relationships.length,
      durationMs: Date.now() - t0,
      model,
    },
  };
}