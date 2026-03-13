import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { saveBattle, saveSectionAudio, listBattles, loadBattle, deleteBattle, getSectionAudioPath } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve built frontend
app.use(express.static(join(__dirname, 'dist')));

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

const QUALITY_FOCUSES = [
  'Maximum HUMOR and comedy — absurd comparisons, anachronistic jokes, funny punchlines, comedic timing. Make it genuinely laugh-out-loud funny.',
  'SAVAGE BURNS and devastating roasts — ruthless personal attacks using real historical facts, career-ending disses, no mercy.',
  'CLEVER WORDPLAY and double entendres — multilayered meanings, sophisticated puns on historical events, genius-level rhyme schemes.',
  'RAW ENERGY and hype — aggressive delivery, crowd-hyping bars, quotable one-liners, mosh-pit energy.',
  'STORYTELLING and historical depth — weave real events into narrative burns, specific dates and facts as weapons, educated roasts.',
];

function buildLyricsPrompt(figure1, figure2, focus) {
  return `You are a rap battle songwriter. Write an epic rap battle song between ${figure1} and ${figure2}.

YOUR SPECIAL FOCUS FOR THIS VERSION: ${focus}

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
- Match the voice to WHO THE PERSON ACTUALLY IS — their gender, ethnicity, accent, and era
- A Japanese emperor should sound like a Japanese male voice, not an American rapper
- A British queen should sound like a refined British female voice rapping
- A Viking should sound like a gruff Nordic male voice
- An Egyptian pharaoh should sound like a powerful Middle Eastern voice
- Consider: gender, ethnic background, regional accent, age, personality, and speaking style
- The voice should feel like THAT PERSON is actually rapping, not a generic rapper
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
}`;
}

app.post('/api/generate', async (req, res) => {
  const { figure1, figure2 } = req.body;
  if (!figure1 || !figure2) {
    return res.status(400).json({ error: 'Two historical figures are required' });
  }

  try {
    // Step 1: Generate 5 versions in parallel, each with a different quality focus
    console.log(`Generating 5 lyric variants for ${figure1} vs ${figure2}...`);
    const variants = await Promise.all(
      QUALITY_FOCUSES.map(async (focus, i) => {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 3000,
          messages: [{ role: 'user', content: buildLyricsPrompt(figure1, figure2, focus) }],
        });
        const text = msg.content[0].text;
        try {
          return { index: i, focus, data: JSON.parse(text) };
        } catch {
          console.error(`Variant ${i} returned invalid JSON`);
          return null;
        }
      })
    );

    const validVariants = variants.filter(Boolean);
    if (validVariants.length === 0) {
      throw new Error('All lyric variants failed to generate valid JSON');
    }

    // Step 2: Have a reviewer grade them and pick the best
    console.log(`Reviewing ${validVariants.length} variants...`);
    const reviewPrompt = `You are a rap battle judge. Below are ${validVariants.length} different versions of a rap battle between ${figure1} and ${figure2}.

Grade each version on these criteria (1-10 each):
1. HUMOR — Is it genuinely funny? Laugh-out-loud moments? (WEIGHT THIS HIGHEST — humor is the #1 priority)
2. BURNS — How savage and devastating are the disses?
3. WORDPLAY — Clever rhymes, double meanings, puns?
4. FLOW — Do the lyrics sound natural when rapped? Good rhythm?
5. HISTORICAL ACCURACY — Are the facts and references real and well-used?

${validVariants.map((v, i) => `
=== VERSION ${i + 1} (Focus: ${v.focus.split('—')[0].trim()}) ===
Title: ${v.data.title}
${v.data.sections.map(s => `[${s.name} - ${s.rapper}]\n${s.lines.join('\n')}`).join('\n\n')}
`).join('\n')}

Return ONLY valid JSON (no markdown, no code fences):
{
  "reviews": [
    { "version": 1, "humor": 8, "burns": 7, "wordplay": 6, "flow": 7, "accuracy": 8, "total_weighted": 0, "standout_lines": ["quote a funny line"] },
    ...
  ],
  "winner": 1,
  "reason": "One sentence why this version is the best"
}

IMPORTANT: For total_weighted, use this formula: humor*3 + burns*2 + wordplay*2 + flow*1.5 + accuracy*1.5. Humor counts TRIPLE.`;

    const reviewMsg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: reviewPrompt }],
    });

    let winnerIndex = 0;
    try {
      const reviewData = JSON.parse(reviewMsg.content[0].text);
      winnerIndex = (reviewData.winner || 1) - 1;
      if (winnerIndex < 0 || winnerIndex >= validVariants.length) winnerIndex = 0;
      console.log(`Review complete. Winner: Version ${winnerIndex + 1} — ${reviewData.reason}`);
      console.log('Scores:', reviewData.reviews?.map((r, i) => `V${i+1}: ${r.total_weighted}`).join(', '));
    } catch {
      console.log('Review parse failed, using first valid variant');
    }

    const battleData = validVariants[winnerIndex].data;

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

// Catch-all: serve frontend for non-API routes
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
