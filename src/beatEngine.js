const BPM = 85
const BEAT_LENGTH = 1 // bars per pattern repeat
const SECONDS_PER_BEAT = 60 / BPM

export function createBeatEngine(audioContext) {
  let isPlaying = false
  let nextNoteTime = 0
  let currentStep = 0
  let timerID = null
  const gainNode = audioContext.createGain()
  gainNode.gain.value = 0.35
  gainNode.connect(audioContext.destination)

  // Kick pattern: hits on 1 and 3
  const kickPattern =  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0]
  // Snare pattern: hits on 2 and 4
  const snarePattern = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
  // Hi-hat pattern
  const hihatPattern = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
  // Bass pattern
  const bassPattern =  [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0]

  function playKick(time) {
    const osc = audioContext.createOscillator()
    const g = audioContext.createGain()
    osc.connect(g)
    g.connect(gainNode)
    osc.frequency.setValueAtTime(150, time)
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.12)
    g.gain.setValueAtTime(1, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.3)
    osc.start(time)
    osc.stop(time + 0.3)
  }

  function playSnare(time) {
    // Noise burst for snare
    const bufferSize = audioContext.sampleRate * 0.15
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }
    const noise = audioContext.createBufferSource()
    noise.buffer = buffer
    const noiseGain = audioContext.createGain()
    const filter = audioContext.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 1000
    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(gainNode)
    noiseGain.gain.setValueAtTime(0.8, time)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15)
    noise.start(time)
    noise.stop(time + 0.15)

    // Tonal body
    const osc = audioContext.createOscillator()
    const g = audioContext.createGain()
    osc.connect(g)
    g.connect(gainNode)
    osc.frequency.setValueAtTime(200, time)
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.07)
    g.gain.setValueAtTime(0.6, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.1)
    osc.start(time)
    osc.stop(time + 0.1)
  }

  function playHihat(time) {
    const bufferSize = audioContext.sampleRate * 0.05
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }
    const noise = audioContext.createBufferSource()
    noise.buffer = buffer
    const g = audioContext.createGain()
    const filter = audioContext.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 7000
    noise.connect(filter)
    filter.connect(g)
    g.connect(gainNode)
    g.gain.setValueAtTime(0.25, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05)
    noise.start(time)
    noise.stop(time + 0.05)
  }

  function playBass(time) {
    const osc = audioContext.createOscillator()
    const g = audioContext.createGain()
    osc.type = 'sawtooth'
    osc.connect(g)
    const filter = audioContext.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 300
    g.connect(filter)
    filter.connect(gainNode)
    // Cycle through notes for a dark trap feel
    const notes = [55, 55, 65.41, 55] // A1, A1, C2, A1
    const noteIndex = Math.floor(currentStep / 4) % notes.length
    osc.frequency.setValueAtTime(notes[noteIndex], time)
    g.gain.setValueAtTime(0.5, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.2)
    osc.start(time)
    osc.stop(time + 0.2)
  }

  function scheduleNote() {
    const stepDuration = (SECONDS_PER_BEAT * 4 * BEAT_LENGTH) / 16
    const step = currentStep % 16

    if (kickPattern[step]) playKick(nextNoteTime)
    if (snarePattern[step]) playSnare(nextNoteTime)
    if (hihatPattern[step]) playHihat(nextNoteTime)
    if (bassPattern[step]) playBass(nextNoteTime)

    nextNoteTime += stepDuration
    currentStep++
  }

  function scheduler() {
    while (nextNoteTime < audioContext.currentTime + 0.1) {
      scheduleNote()
    }
    timerID = setTimeout(scheduler, 25)
  }

  return {
    start() {
      if (isPlaying) return
      isPlaying = true
      currentStep = 0
      nextNoteTime = audioContext.currentTime + 0.05
      scheduler()
    },
    stop() {
      isPlaying = false
      if (timerID) {
        clearTimeout(timerID)
        timerID = null
      }
    },
    setVolume(v) {
      gainNode.gain.value = v
    },
    get playing() {
      return isPlaying
    }
  }
}
