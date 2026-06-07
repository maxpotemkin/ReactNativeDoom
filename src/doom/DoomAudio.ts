import { AudioContext, type AudioBuffer } from 'react-native-audio-api';

import { FRAME_BYTES } from './frameConstants';

const PACKET_MAGIC = 0x58414d44;
const PACKET_HEADER_BYTES = 8;
const EVENT_HEADER_BYTES = 24;

type DoomAudioEvent = {
  channel: number;
  frameCount: number;
  pan: number;
  sampleRate: number;
  samples: Float32Array;
  sfxId: number;
  volume: number;
};

class DoomAudioPlayer {
  private audioContext: AudioContext | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private resumeInFlight = false;
  private totalEvents = 0;
  private totalPlayed = 0;
  private totalDropped = 0;

  get eventCount() {
    return this.totalEvents;
  }

  get playedCount() {
    return this.totalPlayed;
  }

  get droppedCount() {
    return this.totalDropped;
  }

  suspend() {
    const context = this.audioContext;
    if (context == null || context.state !== 'running') {
      return;
    }

    context.suspend().catch(error => {
      const message =
        error instanceof Error ? error.message : 'failed to suspend audio';
      console.warn(`[DoomAudio] ${message}`);
    });
  }

  close() {
    const context = this.audioContext;
    this.audioContext = null;
    this.resumeInFlight = false;
    this.bufferCache.clear();

    if (context == null || context.state === 'closed') {
      return;
    }

    context.close().catch(error => {
      const message =
        error instanceof Error ? error.message : 'failed to close audio';
      console.warn(`[DoomAudio] ${message}`);
    });
  }

  extractFrameAndPlayAudio(packet: ArrayBuffer): Uint8Array {
    if (packet.byteLength < PACKET_HEADER_BYTES) {
      return new Uint8Array(packet);
    }

    const view = new DataView(packet);
    const magic = view.getUint32(0, true);
    const frameBytes = view.getUint32(4, true);
    if (
      magic !== PACKET_MAGIC ||
      frameBytes !== FRAME_BYTES ||
      packet.byteLength < PACKET_HEADER_BYTES + frameBytes + 4
    ) {
      return new Uint8Array(packet);
    }

    const frame = new Uint8Array(packet, PACKET_HEADER_BYTES, frameBytes);
    let offset = PACKET_HEADER_BYTES + frameBytes;
    const eventCount = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < eventCount; i += 1) {
      if (offset + EVENT_HEADER_BYTES > packet.byteLength) {
        this.totalDropped += 1;
        break;
      }

      const sfxId = view.getInt32(offset, true);
      const channel = view.getInt32(offset + 4, true);
      const sampleRate = view.getInt32(offset + 8, true);
      const frameCount = view.getInt32(offset + 12, true);
      const volume = view.getFloat32(offset + 16, true);
      const pan = view.getFloat32(offset + 20, true);
      offset += EVENT_HEADER_BYTES;

      const sampleBytes = frameCount * Float32Array.BYTES_PER_ELEMENT;
      if (
        frameCount <= 0 ||
        sampleRate < 8000 ||
        sampleRate > 96000 ||
        offset + sampleBytes > packet.byteLength ||
        offset % Float32Array.BYTES_PER_ELEMENT !== 0
      ) {
        this.totalDropped += 1;
        break;
      }

      this.totalEvents += 1;
      this.playSound({
        channel,
        frameCount,
        pan,
        sampleRate,
        samples: new Float32Array(packet, offset, frameCount),
        sfxId,
        volume,
      });
      offset += sampleBytes;
    }

    return frame;
  }

  private getContext() {
    if (this.audioContext == null) {
      this.audioContext = new AudioContext();
    }

    return this.audioContext;
  }

  private playSound(event: DoomAudioEvent) {
    try {
      const context = this.getContext();
      const source = context.createBufferSource();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      const now = context.currentTime;

      source.buffer = this.getOrCreateBuffer(context, event);
      gain.gain.setValueAtTime(event.volume, now);
      panner.pan.setValueAtTime(event.pan, now);

      source.connect(gain);
      gain.connect(panner);
      panner.connect(context.destination);
      source.onEnded = () => {
        source.disconnect();
        gain.disconnect();
        panner.disconnect();
      };
      source.start(now);

      this.totalPlayed += 1;
      this.resumeContext(context);
    } catch (error) {
      this.totalDropped += 1;
      const message =
        error instanceof Error ? error.message : 'failed to play Doom sound';
      console.warn(`[DoomAudio] ${message}`);
    }
  }

  private getOrCreateBuffer(context: AudioContext, event: DoomAudioEvent) {
    const cacheKey = `${event.sfxId}:${event.sampleRate}:${event.frameCount}`;
    const cached = this.bufferCache.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const audioBuffer = context.createBuffer(
      1,
      event.frameCount,
      event.sampleRate,
    );
    const samples =
      event.samples.byteOffset === 0 &&
      event.samples.byteLength === event.samples.buffer.byteLength
        ? event.samples
        : new Float32Array(event.samples);
    audioBuffer.copyToChannel(samples, 0, 0);
    this.bufferCache.set(cacheKey, audioBuffer);
    return audioBuffer;
  }

  private resumeContext(context: AudioContext) {
    if (context.state !== 'suspended' || this.resumeInFlight) {
      return;
    }

    this.resumeInFlight = true;
    context
      .resume()
      .catch(error => {
        const message =
          error instanceof Error ? error.message : 'failed to resume audio';
        console.warn(`[DoomAudio] ${message}`);
      })
      .finally(() => {
        this.resumeInFlight = false;
      });
  }
}

export const doomAudio = new DoomAudioPlayer();
