import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { saveBattle, saveSectionAudio, listBattles, loadBattle, deleteBattle, getSectionAudioPath } from './db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GLOBAL_STYLES = [
  'hip-hop rap battle',
  'aggressive 808 bass',
  'trap drums',
  'dark minor key',
  '90 BPM',
  'hard-hitting beats',
];

const NEGATIVE_STYLES = [
  'pop', 'country', 'jazz', 'acoustic', 'soft', 'romantic', 'slow ballad', 'long instrumental intro',
];

// ---- BATTLES LIST ----

app.get('/api/battles', (_req, res) => {
  const battles = listBattles();
  res.json(battles);
});

app.get('/api/battles/:id', (req, res) => {
  const battle = loadBattle(Number(req.params.id));
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json(battle);
});

app.delete('/api/battles/:id', (req, res) => {
  deleteBattle(Number(req.params.id));
  res.json({ ok: true });
});

// ---- WIKIPEDIA IMAGE ----

app.get('/api/image/:name', async (req, res) => {
  const name = req.params.name;
  try {
    // Try Wikipedia API for page image
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const wikiRes = await fetch(searchUrl);
    if (wikiRes.ok) {
      const data = await wikiRes.json();
      if (data.thumbnail?.source) {
        // Get higher res version
        const hiRes = data.originalimage?.source || data.thumbnail.source;
        return res.json({ url: hiRes, source: 'wikipedia' });
      }
    }
    // Fallback: no image
    res.json({ url: null, source: null });
  } catch {
    res.json({ url: null, source: null });
  }
});

// ---- SERVE SECTION AUDIO ----

app.get('/api/audio/:filename', (req, res) => {
  const filepath = getSectionAudioPath(req.params.filename);
  if (!filepath) return res.status(404).json({ error: 'Audio not found' });
  res.set('Content-Type', 'audio/mpeg');
  res.sendFile(filepath);
});

// ---- GENERATE LYRICS (Claude) ----

app.post('/api/generate', async (req, res) => {
  const { figure1, figure2 } = req.body;
  if (!figure1 || !figure2) {
    return res.status(400).json({ error: 'Two historical figures are required' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: `You are a rap battle songwriter. Write an epic rap battle song between ${figure1} and ${figure2}.

This will be turned into ACTUAL SONGS using AI music generation. Each section will be generated as a separate track with its own distinct voice, then spliced together.

SONG STRUCTURE (each section = separate track):
1. Intro — hype announcer, 2 lines
2. Verse 1 — ${figure1} opens
3. Verse 2 — ${figure2} fires back
4. Chorus — catchy battle hook
5. Verse 3 — ${figure1} escalates
6. Verse 4 — ${figure2} goes harder
7. Chorus — same hook
8. Verse 5 — ${figure1} DEVASTATING finale
9. Verse 6 — ${figure2} DEVASTATING finale
10. Outro — epic closing, 1-2 lines

LYRICS RULES:
- Each verse: exactly 4 lines. Each line MAX 180 characters
- Chorus: 2-3 lines, catchy and repeatable
- Intro/Outro: 1-2 lines each
- Write like actual rap — contractions, slang, hard rhymes, punchlines, wordplay
- Internal rhymes, multisyllabic rhymes
- Real historical facts twisted into burns
- Escalate aggression each round
- NO copyrighted artist/song names in lyrics
- Keep lyrics CLEAN of any markup or tags

VOCAL DESCRIPTIONS (critical - these control the AI singer voice):
- For ${figure1}: describe the ideal rap voice (e.g. "deep aggressive male rapper with gravelly tone")
- For ${figure2}: describe the ideal rap voice (e.g. "fierce confident female rapper with powerful delivery")
- These must sound DIFFERENT from each other
- For narrator/chorus: describe a distinct announcer or group chant voice

Return ONLY valid JSON (no markdown, no code fences):
{
  "title": "Battle title",
  "figure1": { "name": "${figure1}", "bio": "One sentence bio", "vocal_style": "detailed rap voice description" },
  "figure2": { "name": "${figure2}", "bio": "One sentence bio", "vocal_style": "detailed rap voice description" },
  "narrator_vocal_style": "dramatic announcer voice description",
  "chorus_vocal_style": "group chant or hook voice description",
  "sections": [
    { "name": "Intro", "rapper": "narrator", "lines": ["line1", "line2"] },
    { "name": "Verse 1", "rapper": "${figure1}", "lines": ["l1", "l2", "l3", "l4"] },
    { "name": "Verse 2", "rapper": "${figure2}", "lines": ["l1", "l2", "l3", "l4"] },
    { "name": "Chorus", "rapper": "chorus", "lines": ["hook1", "hook2"] },
    { "name": "Verse 3", "rapper": "${figure1}", "lines": ["l1", "l2", "l3", "l4"] },
    { "name": "Verse 4", "rapper": "${figure2}", "lines": ["l1", "l2", "l3", "l4"] },
    { "name": "Chorus", "rapper": "chorus", "lines": ["hook1", "hook2"] },
    { "name": "Verse 5", "rapper": "${figure1}", "lines": ["l1", "l2", "l3", "l4"] },
    { "name": "Verse 6", "rapper": "${figure2}", "lines": ["l1", "l2", "l3", "l4"] },
    { "name": "Outro", "rapper": "narrator", "lines": ["closing line"] }
  ]
}`
        }
      ]
    });

    const text = message.content[0].text;
    const battleData = JSON.parse(text);

    // Save to DB
    const { battleId, sectionIds } = saveBattle(figure1, figure2, battleData);

    res.json({ battleId, sectionIds, ...battleData });
  } catch (err) {
    console.error('Generate error:', err);
    const msg = err?.error?.error?.message || err.message || 'Failed to generate rap battle';
    res.status(500).json({ error: msg });
  }
});

// ---- COMPOSE SINGLE SECTION (ElevenLabs Music) ----

app.post('/api/compose-section', async (req, res) => {
  const { sectionId, section, battle } = req.body;
  if (!section || !battle) {
    return res.status(400).json({ error: 'Section and battle data required' });
  }

  // Determine vocal style
  let vocalStyle;
  if (section.rapper === battle.figure1.name) {
    vocalStyle = battle.figure1.vocal_style;
  } else if (section.rapper === battle.figure2.name) {
    vocalStyle = battle.figure2.vocal_style;
  } else if (section.rapper === 'chorus') {
    vocalStyle = battle.chorus_vocal_style;
  } else {
    vocalStyle = battle.narrator_vocal_style;
  }

  let duration_ms = 15000;
  if (section.name === 'Intro') duration_ms = 8000;
  else if (section.name === 'Outro') duration_ms = 8000;
  else if (section.name === 'Chorus') duration_ms = 10000;

  const compositionPlan = {
    positive_global_styles: [
      ...GLOBAL_STYLES,
      vocalStyle,
      'vocals start immediately',
      'minimal instrumental intro',
    ],
    negative_global_styles: [
      ...NEGATIVE_STYLES,
      'long intro',
      'instrumental intro',
      'slow buildup',
    ],
    sections: [
      {
        section_name: section.name,
        positive_local_styles: [vocalStyle, 'vocals from the start', 'rap verse'],
        negative_local_styles: ['instrumental only', 'long intro', 'slow start'],
        duration_ms,
        lines: section.lines,
      },
    ],
  };

  console.log(`Composing ${section.name} (${section.rapper}) [sectionId=${sectionId}]`);

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/music/compose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        composition_plan: compositionPlan,
        strict_section_durations: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`Music compose error (${section.name}):`, err);
      return res.status(response.status).json({ error: `Failed to compose ${section.name}: ${err}` });
    }

    const arrayBuffer = await response.arrayBuffer();

    // Save audio to DB
    if (sectionId) {
      saveSectionAudio(sectionId, arrayBuffer);
      console.log(`Saved audio for section ${sectionId}`);
    }

    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(`Compose error (${section.name}):`, err);
    res.status(500).json({ error: `Failed to compose ${section.name}` });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
