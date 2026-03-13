# 11-Mile

AI rap battle generator. Pick two historical figures, Claude writes the bars, ElevenLabs drops the beat.

## Setup

1. **Clone the repo**
   ```
   git clone https://github.com/henrybrewer00-dotcom/eleven-mile.git
   cd eleven-mile
   ```

2. **Install dependencies**
   ```
   npm install
   ```

3. **Add your API keys**

   Create a `.env` file in the root:
   ```
   ANTHROPIC_API_KEY=your-anthropic-key-here
   ELEVENLABS_API_KEY=your-elevenlabs-key-here
   ```

   You'll need:
   - An [Anthropic API key](https://console.anthropic.com/) with credits
   - An [ElevenLabs API key](https://elevenlabs.io/) (paid plan required for Music API)

4. **Start the backend**
   ```
   npm run server
   ```

5. **Start the frontend** (in a second terminal)
   ```
   npm run dev
   ```

6. **Open** http://localhost:5173 in your browser

## How It Works

- Enter two historical figures and hit generate
- Claude writes a full rap battle script with distinct vocal styles
- ElevenLabs Music API composes each section as a separate track
- Sections are trimmed, crossfaded, and spliced into one song
- Battles are saved to a local SQLite database for replay
- Watch Performance mode shows Wikipedia portraits that light up per verse
