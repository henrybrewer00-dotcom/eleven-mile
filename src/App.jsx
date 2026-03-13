import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const API = 'http://localhost:3001/api'
const PARALLEL_BATCH_SIZE = 2

function App() {
  const [view, setView] = useState('home') // home | create | battle
  const [battles, setBattles] = useState([])
  const [figure1, setFigure1] = useState('')
  const [figure2, setFigure2] = useState('')
  const [battle, setBattle] = useState(null)
  const [battleId, setBattleId] = useState(null)
  const [sectionIds, setSectionIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [songUrl, setSongUrl] = useState(null)
  const [sectionUrls, setSectionUrls] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSection, setCurrentSection] = useState(-1)
  const [img1, setImg1] = useState(null)
  const [img2, setImg2] = useState(null)
  const [sectionTimings, setSectionTimings] = useState([])
  const [playbackTime, setPlaybackTime] = useState(0)
  const [showStage, setShowStage] = useState(false)
  const [includeChorus, setIncludeChorus] = useState(false)
  const [showVote, setShowVote] = useState(false)
  const [voted, setVoted] = useState(null)
  const audioRef = useRef(null)
  const songAudioRef = useRef(null)
  const rafRef = useRef(null)
  const canvasRef = useRef(null)
  const analyserRef = useRef(null)
  const audioCtxRef = useRef(null)
  const sourceNodeRef = useRef(null)

  useEffect(() => {
    fetchBattles()
  }, [])

  // Re-splice when chorus toggle changes
  useEffect(() => {
    if (!sectionUrls.length || !sectionUrls.every(u => u) || !sections.length) return
    const reSplice = async () => {
      const chorusSkip = includeChorus ? [] : getChorusIndices(sections)
      const { url, timings } = await spliceAudio(sectionUrls, chorusSkip)
      setSongUrl(url)
      setSectionTimings(timings)
    }
    reSplice()
  }, [includeChorus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track playback time via requestAnimationFrame
  const startTracking = useCallback(() => {
    const tick = () => {
      const audio = songAudioRef.current
      if (audio && !audio.paused) {
        setPlaybackTime(audio.currentTime)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // Audio visualizer
  const setupAnalyser = useCallback(() => {
    const audio = songAudioRef.current
    if (!audio) return

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    const ctx = audioCtxRef.current

    if (!sourceNodeRef.current) {
      sourceNodeRef.current = ctx.createMediaElementSource(audio)
    }

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    sourceNodeRef.current.connect(analyser)
    analyser.connect(ctx.destination)
    analyserRef.current = analyser
  }, [])

  const vizRafRef = useRef(null)
  const vizRunningRef = useRef(false)

  const drawVisualizer = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext('2d')
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    vizRunningRef.current = true

    const draw = () => {
      if (!vizRunningRef.current) return
      vizRafRef.current = requestAnimationFrame(draw)

      analyser.getByteFrequencyData(dataArray)

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      const barCount = 48
      const barWidth = w / barCount
      const gap = 2

      // Check energy to pick color (avoids stale closure)
      const lowEnergy = dataArray.slice(0, 8).reduce((a, b) => a + b, 0)
      const highEnergy = dataArray.slice(24, 48).reduce((a, b) => a + b, 0)

      for (let i = 0; i < barCount; i++) {
        const dataIdx = Math.floor(i * bufferLength / barCount)
        const value = dataArray[dataIdx] / 255
        const barHeight = value * h * 0.8

        // Default gold, canvas color will be overridden by CSS class on stage-container
        const r = 255, g = 204, b = 0
        const alpha = 0.15 + value * 0.35
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`

        const x = i * barWidth + gap / 2
        ctx.fillRect(x, h - barHeight, barWidth - gap, barHeight)

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`
        ctx.fillRect(x, 0, barWidth - gap, barHeight * 0.3)
      }
    }
    draw()
  }, [])

  const stopVisualizer = useCallback(() => {
    vizRunningRef.current = false
    if (vizRafRef.current) {
      cancelAnimationFrame(vizRafRef.current)
      vizRafRef.current = null
    }
  }, [])

  const stopTracking = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // Determine active section from playback time (returns original section index)
  const getActiveSection = useCallback(() => {
    if (!sectionTimings.length || !isPlaying) return -1
    for (let i = 0; i < sectionTimings.length; i++) {
      if (playbackTime >= sectionTimings[i].start && playbackTime < sectionTimings[i].end) {
        return sectionTimings[i].originalIndex ?? i
      }
    }
    return -1
  }, [sectionTimings, playbackTime, isPlaying])

  const activeSectionIdx = getActiveSection()

  // Fetch fighter images from Wikipedia
  const fetchImages = async (name1, name2) => {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${API}/image/${encodeURIComponent(name1)}`).then(r => r.json()),
        fetch(`${API}/image/${encodeURIComponent(name2)}`).then(r => r.json()),
      ])
      setImg1(r1.url)
      setImg2(r2.url)
    } catch {
      setImg1(null)
      setImg2(null)
    }
  }

  const fetchBattles = async () => {
    try {
      const res = await fetch(`${API}/battles`)
      const data = await res.json()
      setBattles(data)
    } catch {}
  }

  const loadExistingBattle = async (id) => {
    setError('')
    setLoading(true)
    setLoadingMsg('Loading battle...')
    setVoted(null)
    setShowVote(false)
    try {
      const res = await fetch(`${API}/battles/${id}`)
      const data = await res.json()
      setBattle(data.battle_json)
      setBattleId(data.id)
      setSectionIds(data.sections.map(s => s.id))

      // Fetch images
      fetchImages(data.battle_json.figure1.name, data.battle_json.figure2.name)

      // Load audio URLs from stored files
      const urls = data.sections.map(s =>
        s.audio_path ? `${API}/audio/${s.audio_path}` : null
      )
      setSectionUrls(urls)

      // If all sections have audio, splice them
      if (urls.every(u => u)) {
        const chorusSkip = includeChorus ? [] : getChorusIndices(data.battle_json.sections)
        const { url, timings } = await spliceAudio(urls, chorusSkip)
        setSongUrl(url)
        setSectionTimings(timings)
      }

      setView('battle')
    } catch (err) {
      setError('Failed to load battle')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  const deleteBattleById = async (id) => {
    await fetch(`${API}/battles/${id}`, { method: 'DELETE' })
    fetchBattles()
  }

  // Compose a single section, returns blob URL
  const composeOne = async (sectionId, section, battleObj) => {
    const songRes = await fetch(`${API}/compose-section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId, section, battle: battleObj }),
    })
    if (!songRes.ok) {
      const errData = await songRes.json().catch(() => ({}))
      throw new Error(errData.error || `Failed to compose ${section.name}`)
    }
    const blob = await songRes.blob()
    return URL.createObjectURL(blob)
  }

  const generateBattle = async () => {
    setError('')
    setBattle(null)
    setSongUrl(null)
    setSectionUrls([])
    setSectionTimings([])
    setImg1(null)
    setImg2(null)
    setVoted(null)
    setShowVote(false)
    setLoading(true)
    setView('battle')

    try {
      // Step 1: Claude writes lyrics, saved to DB
      setLoadingMsg('Claude is writing the rap battle lyrics...')
      const res = await fetch(`${API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figure1, figure2 }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to generate lyrics')
      }
      const data = await res.json()
      setBattle(data)
      setBattleId(data.battleId)
      setSectionIds(data.sectionIds)

      // Fetch images
      fetchImages(data.figure1.name, data.figure2.name)

      // Step 2: Compose sections in parallel batches
      const urls = new Array(data.sections.length).fill(null)
      const total = data.sections.length

      for (let batchStart = 0; batchStart < total; batchStart += PARALLEL_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE, total)
        const batchNames = data.sections.slice(batchStart, batchEnd).map(s => s.name).join(', ')
        setLoadingMsg(`Producing ${batchNames} (${batchStart + 1}-${batchEnd}/${total})...`)

        const promises = []
        for (let i = batchStart; i < batchEnd; i++) {
          promises.push(
            composeOne(data.sectionIds[i], data.sections[i], data).then(url => {
              urls[i] = url
            })
          )
        }
        await Promise.all(promises)
      }
      setSectionUrls(urls)

      // Step 3: Splice
      setLoadingMsg('Splicing into final song...')
      const chorusSkip = includeChorus ? [] : getChorusIndices(data.sections)
      const { url, timings } = await spliceAudio(urls, chorusSkip)
      setSongUrl(url)
      setSectionTimings(timings)

      fetchBattles()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  const recomposeSection = async (index) => {
    if (!battle || !sectionIds[index]) return
    const section = battle.sections[index]
    setLoadingMsg(`Re-composing ${section.name}...`)
    setLoading(true)
    setError('')

    try {
      const url = await composeOne(sectionIds[index], section, battle)
      const newUrls = [...sectionUrls]
      newUrls[index] = url
      setSectionUrls(newUrls)

      // Re-splice
      if (newUrls.every(u => u)) {
        const chorusSkip = includeChorus ? [] : getChorusIndices(sections)
        const { url: finalUrl, timings } = await spliceAudio(newUrls, chorusSkip)
        setSongUrl(finalUrl)
        setSectionTimings(timings)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  // Trim silence from start and end of an AudioBuffer
  const trimSilence = (audioCtx, audioBuffer, threshold = 0.01) => {
    const ch0 = audioBuffer.getChannelData(0)
    const len = audioBuffer.length
    const sr = audioBuffer.sampleRate
    const channels = audioBuffer.numberOfChannels

    const windowSize = Math.floor(sr * 0.02)

    const getEnergy = (start, size) => {
      let sum = 0
      const end = Math.min(start + size, len)
      for (let i = start; i < end; i++) {
        sum += Math.abs(ch0[i])
      }
      return sum / (end - start)
    }

    let trimStart = 0
    for (let i = 0; i < len - windowSize; i += windowSize) {
      if (getEnergy(i, windowSize) > threshold) {
        trimStart = Math.max(0, i - Math.floor(sr * 0.05))
        break
      }
    }

    let trimEnd = len
    for (let i = len - windowSize; i > trimStart; i -= windowSize) {
      if (getEnergy(i, windowSize) > threshold) {
        trimEnd = Math.min(len, i + windowSize + Math.floor(sr * 0.03))
        break
      }
    }

    const trimmedLength = trimEnd - trimStart
    if (trimmedLength <= 0 || trimmedLength >= len) return audioBuffer

    const trimmed = audioCtx.createBuffer(channels, trimmedLength, sr)
    for (let ch = 0; ch < channels; ch++) {
      const src = audioBuffer.getChannelData(ch)
      trimmed.getChannelData(ch).set(src.subarray(trimStart, trimEnd))
    }
    return trimmed
  }

  const spliceAudio = async (urls, skipIndices = []) => {
    const audioCtx = new AudioContext()
    const allBuffers = []
    for (const url of urls) {
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const raw = await audioCtx.decodeAudioData(arrayBuffer)
      const trimmed = trimSilence(audioCtx, raw)
      allBuffers.push(trimmed)
    }

    const indexMap = []
    const buffers = []
    for (let i = 0; i < allBuffers.length; i++) {
      if (!skipIndices.includes(i)) {
        buffers.push(allBuffers[i])
        indexMap.push(i)
      }
    }

    if (buffers.length === 0) {
      audioCtx.close()
      return { url: null, timings: [] }
    }

    const crossfadeSamples = Math.floor(buffers[0].sampleRate * 0.2)
    const sampleRate = buffers[0].sampleRate
    const channels = buffers[0].numberOfChannels

    let totalLength = buffers[0].length
    for (let i = 1; i < buffers.length; i++) {
      totalLength += buffers[i].length - crossfadeSamples
    }

    const combined = audioCtx.createBuffer(channels, totalLength, sampleRate)

    const timings = []
    let offset = 0
    for (let b = 0; b < buffers.length; b++) {
      const buf = buffers[b]
      const startTime = offset / sampleRate

      for (let ch = 0; ch < channels; ch++) {
        const src = buf.getChannelData(ch)
        const dst = combined.getChannelData(ch)

        for (let i = 0; i < buf.length; i++) {
          let sample = src[i]

          if (b > 0 && i < crossfadeSamples) {
            sample *= i / crossfadeSamples
          }
          if (b < buffers.length - 1 && i >= buf.length - crossfadeSamples) {
            sample *= (buf.length - i) / crossfadeSamples
          }

          dst[offset + i] += sample
        }
      }
      offset += buf.length - (b < buffers.length - 1 ? crossfadeSamples : 0)
      const endTime = offset / sampleRate
      timings.push({ start: startTime, end: endTime, originalIndex: indexMap[b] })
    }

    const wav = encodeWav(combined)
    const blob = new Blob([wav], { type: 'audio/wav' })
    audioCtx.close()
    return { url: URL.createObjectURL(blob), timings }
  }

  const encodeWav = (audioBuffer) => {
    const numCh = audioBuffer.numberOfChannels
    const sr = audioBuffer.sampleRate
    const bps = 16
    const blockAlign = numCh * (bps / 8)
    const dataLen = audioBuffer.length * blockAlign
    const buf = new ArrayBuffer(44 + dataLen)
    const v = new DataView(buf)
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
    w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE')
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
    v.setUint16(22, numCh, true); v.setUint32(24, sr, true)
    v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true)
    v.setUint16(34, bps, true); w(36, 'data'); v.setUint32(40, dataLen, true)
    const chs = []; for (let c = 0; c < numCh; c++) chs.push(audioBuffer.getChannelData(c))
    let off = 44
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chs[c][i]))
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
        off += 2
      }
    }
    return buf
  }

  const playSong = () => {
    if (!songUrl) return
    const audio = songAudioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      setShowStage(false)
      stopTracking()
      stopVisualizer()
    } else {
      // Setup analyser on first play
      if (!analyserRef.current) {
        setupAnalyser()
      }
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      audio.play()
      setIsPlaying(true)
      setShowStage(true)
      setShowVote(false)
      setVoted(null)
      startTracking()
      drawVisualizer()
    }
  }

  const onSongEnded = () => {
    setIsPlaying(false)
    stopTracking()
    stopVisualizer()
    setShowVote(true)
  }

  const castVote = (fighter) => {
    setVoted(fighter)
  }

  const closeVote = () => {
    setShowVote(false)
    setShowStage(false)
    setVoted(null)
  }

  const playSection = (index) => {
    if (!sectionUrls[index]) return
    const audio = audioRef.current
    audio.src = sectionUrls[index]
    setCurrentSection(index)
    setIsPlaying(true)
    audio.onended = () => { setCurrentSection(-1); setIsPlaying(false) }
    audio.play()
  }

  const getSectionColor = (section) => {
    if (!battle) return 'gold'
    const bd = battle.battle_json || battle
    if (section.rapper === bd.figure1?.name) return 'red'
    if (section.rapper === bd.figure2?.name) return 'blue'
    return 'gold'
  }

  const getChorusIndices = (secs) => {
    return secs.reduce((acc, s, i) => {
      if (s.name === 'Chorus' || s.rapper === 'chorus') acc.push(i)
      return acc
    }, [])
  }

  const battleData = battle?.battle_json || battle
  const sections = battle?.sections
    ? (battle.sections[0]?.lines_json ? battle.sections.map(s => ({ ...s, lines: s.lines_json, name: s.name, rapper: s.rapper })) : battle.sections)
    : battleData?.sections || []

  // Determine which fighter is active
  const getActiveFighter = () => {
    if (activeSectionIdx < 0 || !sections[activeSectionIdx]) return null
    const section = sections[activeSectionIdx]
    const bd = battleData
    if (section.rapper === bd?.figure1?.name) return 1
    if (section.rapper === bd?.figure2?.name) return 2
    return null // narrator/chorus
  }

  const activeFighter = getActiveFighter()

  // ---- HOME VIEW ----
  if (view === 'home') {
    return (
      <>
        <div className="app-header">
          <h1><span className="fire">11</span>-MILE</h1>
          <p>Pick two historical figures. We make it a real song.</p>
        </div>

        <button className="btn btn-fire" onClick={() => setView('create')} style={{ marginBottom: 32 }}>
          New Battle
        </button>

        {battles.length > 0 && (
          <div className="battle-list">
            <h2 className="list-title">Previous Battles</h2>
            {battles.map(b => (
              <div key={b.id} className="battle-list-item" onClick={() => loadExistingBattle(b.id)}>
                <div className="battle-list-info">
                  <span className="battle-list-title">{b.title || `${b.figure1} vs ${b.figure2}`}</span>
                  <span className="battle-list-date">{new Date(b.created_at + 'Z').toLocaleDateString()}</span>
                </div>
                <div className="battle-list-fighters">
                  <span className="bio-name red">{b.figure1}</span>
                  <span className="vs-small">vs</span>
                  <span className="bio-name blue">{b.figure2}</span>
                </div>
                <button
                  className="delete-btn"
                  onClick={(e) => { e.stopPropagation(); deleteBattleById(b.id) }}
                  title="Delete battle"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {battles.length === 0 && (
          <p className="empty-state">No battles yet. Create your first one!</p>
        )}

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <p>{loadingMsg}</p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </>
    )
  }

  // ---- CREATE VIEW ----
  if (view === 'create') {
    return (
      <>
        <div className="app-header">
          <h1><span className="fire">11</span>-MILE</h1>
          <p>Pick two historical figures. We make it a real song.</p>
        </div>

        <button className="back-btn" onClick={() => setView('home')}>&larr; Back</button>

        <div className="setup-card">
          <div className="fighters-row">
            <div className="fighter-input red">
              <label>Fighter 1</label>
              <input
                type="text"
                placeholder="e.g. Cleopatra"
                value={figure1}
                onChange={e => setFigure1(e.target.value)}
              />
            </div>
            <div className="vs-badge">VS</div>
            <div className="fighter-input blue">
              <label>Fighter 2</label>
              <input
                type="text"
                placeholder="e.g. Elizabeth I"
                value={figure2}
                onChange={e => setFigure2(e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn btn-fire"
            disabled={!figure1 || !figure2 || loading}
            onClick={generateBattle}
          >
            Generate Rap Battle Song
          </button>
        </div>

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <p>{loadingMsg}</p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </>
    )
  }

  // ---- BATTLE VIEW ----
  const fig1 = battleData?.figure1
  const fig2 = battleData?.figure2

  return (
    <>
      <div className="app-header">
        <h1><span className="fire">11</span>-MILE</h1>
      </div>

      <button className="back-btn" onClick={() => {
        setView('home'); setBattle(null); setSongUrl(null); setSectionUrls([])
        setSectionTimings([]); setError(''); setShowStage(false); stopTracking(); stopVisualizer()
        setImg1(null); setImg2(null); setIsPlaying(false); setShowVote(false); setVoted(null)
      }}>
        &larr; All Battles
      </button>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>{loadingMsg}</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {battleData && (
        <div className="battle-card">
          <h2 className="battle-title">{battleData.title}</h2>

          {/* Watch Performance button + chorus toggle - at the top */}
          {songUrl && !showVote && (
            <div className="performance-controls">
              <button
                className={`btn ${isPlaying && showStage ? 'btn-stop' : 'btn-play'}`}
                onClick={playSong}
              >
                {isPlaying && showStage ? 'Stop Performance' : 'Watch Performance'}
              </button>
              <div className="chorus-toggle">
                <label>
                  <input
                    type="checkbox"
                    checked={includeChorus}
                    onChange={e => setIncludeChorus(e.target.checked)}
                  />
                  Include Chorus
                </label>
              </div>
            </div>
          )}

          {/* FULLSCREEN PERFORMANCE OVERLAY */}
          {(showStage || showVote) && sectionTimings.length > 0 && (
            <div className="performance-overlay">
              <button className="perf-close-btn" onClick={() => {
                const audio = songAudioRef.current
                if (audio) audio.pause()
                setIsPlaying(false); setShowStage(false); setShowVote(false)
                stopTracking(); stopVisualizer()
              }}>&times;</button>

              <canvas
                ref={canvasRef}
                className="visualizer-canvas-fullscreen"
                width={800}
                height={400}
              />

              <div className="perf-content">
                <div className="stage">
                  <div className={`stage-fighter left ${activeFighter === 1 ? 'active' : ''} ${activeFighter === 2 ? 'dim' : ''} ${activeFighter === null && isPlaying ? 'both-glow' : ''} ${showVote && voted === 1 ? 'winner' : ''} ${showVote && voted === 2 ? 'loser' : ''}`}>
                    {img1 ? (
                      <img src={img1} alt={fig1?.name} className="fighter-portrait" />
                    ) : (
                      <div className="fighter-portrait placeholder">{fig1?.name?.[0]}</div>
                    )}
                    <div className="fighter-name red">{fig1?.name}</div>
                  </div>

                  <div className="stage-vs">
                    {!showVote && activeSectionIdx >= 0 && sections[activeSectionIdx] && (
                      <div className="stage-section-label">
                        {sections[activeSectionIdx].name}
                      </div>
                    )}
                    <span className="stage-vs-text">VS</span>
                  </div>

                  <div className={`stage-fighter right ${activeFighter === 2 ? 'active' : ''} ${activeFighter === 1 ? 'dim' : ''} ${activeFighter === null && isPlaying ? 'both-glow' : ''} ${showVote && voted === 2 ? 'winner' : ''} ${showVote && voted === 1 ? 'loser' : ''}`}>
                    {img2 ? (
                      <img src={img2} alt={fig2?.name} className="fighter-portrait" />
                    ) : (
                      <div className="fighter-portrait placeholder">{fig2?.name?.[0]}</div>
                    )}
                    <div className="fighter-name blue">{fig2?.name}</div>
                  </div>
                </div>

                {/* LYRICS */}
                {!showVote && activeSectionIdx >= 0 && sections[activeSectionIdx] && (
                  <div className={`lyrics-highlight ${getSectionColor(sections[activeSectionIdx])}`}>
                    <div className="lyrics-text">
                      {(Array.isArray(sections[activeSectionIdx].lines) ? sections[activeSectionIdx].lines : (sections[activeSectionIdx].lines_json || [])).join('\n')}
                    </div>
                  </div>
                )}

                {/* VOTE */}
                {showVote && (
                  <div className="vote-screen">
                    <h3 className="vote-title">Who Won?</h3>
                    {!voted ? (
                      <div className="vote-buttons">
                        <button className="vote-btn red" onClick={() => castVote(1)}>
                          {fig1?.name}
                        </button>
                        <button className="vote-btn blue" onClick={() => castVote(2)}>
                          {fig2?.name}
                        </button>
                      </div>
                    ) : (
                      <div className="vote-result">
                        <div className="vote-winner-name">
                          {voted === 1 ? fig1?.name : fig2?.name}
                        </div>
                        <div className="vote-winner-label">WINS THE BATTLE</div>
                        <button className="btn btn-fire" onClick={closeVote} style={{ marginTop: 20, maxWidth: 300, margin: '20px auto 0' }}>
                          Done
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Fighter portraits + section recompose (when not in stage mode) */}
          {!showStage && !showVote && fig1 && fig2 && (
            <div className="battle-bios">
              <div className="stage-portraits-static">
                <div className="portrait-bio">
                  {img1 ? (
                    <img src={img1} alt={fig1.name} className="fighter-portrait-small" />
                  ) : (
                    <div className="fighter-portrait-small placeholder">{fig1.name?.[0]}</div>
                  )}
                  <span className="bio-name red">{fig1.name}</span>
                  <span className="bio-text">{fig1.bio}</span>
                </div>
                <div className="portrait-bio">
                  {img2 ? (
                    <img src={img2} alt={fig2.name} className="fighter-portrait-small" />
                  ) : (
                    <div className="fighter-portrait-small placeholder">{fig2.name?.[0]}</div>
                  )}
                  <span className="bio-name blue">{fig2.name}</span>
                  <span className="bio-text">{fig2.bio}</span>
                </div>
              </div>
            </div>
          )}

          {/* Section controls (when not in stage mode) */}
          {!showStage && !showVote && (
            <div className="sections-list">
              {sections.map((section, i) => {
                const color = getSectionColor(section)
                const hasAudio = !!sectionUrls[i]
                return (
                  <div key={i} className={`section-row ${color} ${currentSection === i ? 'active' : ''}`}>
                    <div className="section-row-label">
                      {section.name}
                      {section.rapper !== 'narrator' && section.rapper !== 'chorus' && (
                        <span> — {section.rapper}</span>
                      )}
                    </div>
                    <div className="section-actions">
                      {hasAudio && (
                        <button
                          className="play-section-btn"
                          onClick={() => playSection(i)}
                          title="Play this section"
                        >
                          {currentSection === i ? '||' : '\u25B6'}
                        </button>
                      )}
                      {!loading && (
                        <button
                          className="recompose-btn"
                          onClick={() => recomposeSection(i)}
                          title="Re-generate this section"
                        >
                          ↻
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {songUrl && !showVote && (
            <div className="audio-section">
              <audio
                ref={songAudioRef}
                src={songUrl}
                onEnded={onSongEnded}
                onPlay={() => { setIsPlaying(true) }}
                onPause={() => { setIsPlaying(false) }}
                className="song-player"
                controls
              />
              <a href={songUrl} download={`${battleData.title || 'rap-battle'}.wav`} className="btn btn-download">
                Download Song
              </a>
            </div>
          )}
        </div>
      )}

      <audio ref={audioRef} hidden onEnded={() => { setIsPlaying(false); setCurrentSection(-1) }} />
    </>
  )
}

export default App
