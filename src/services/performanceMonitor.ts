// Performance monitoring module for TTF and stall tracking
// Records per-track metrics and provides CSV report

interface TrackMetrics {
  start: number; // timestamp when playback started for this track
  firstFrame?: number; // timestamp when first frame rendered
  ttf?: number; // time to first frame in ms
  stallDuration: number; // accumulated stall time in ms
  stallStart?: number; // timestamp when current stall started
}

const metrics: Record<string, TrackMetrics> = {};

export const performanceMonitor = {
  /** Called when a track begins loading/playback */
  start(bvid: string) {
    metrics[bvid] = { start: Date.now(), stallDuration: 0 };
  },

  /** Called when the first audio frame is successfully rendered */
  firstFrame(bvid: string) {
    const m = metrics[bvid];
    if (m && !m.firstFrame) {
      m.firstFrame = Date.now();
      m.ttf = m.firstFrame - m.start;
    }
  },

  /** Called when buffering stall begins */
  stallStart(bvid: string) {
    const m = metrics[bvid];
    if (m && !m.stallStart) {
      m.stallStart = Date.now();
    }
  },

  /** Called when buffering stall ends */
  stallEnd(bvid: string) {
    const m = metrics[bvid];
    if (m && m.stallStart) {
      m.stallDuration += Date.now() - m.stallStart;
      delete m.stallStart;
    }
  },

  /** Generate CSV report of collected metrics */
  getReport(): string {
    const header = 'bvid,ttf_ms,stall_ms';
    const rows = Object.entries(metrics).map(([bvid, m]) => {
      const ttf = m.ttf !== undefined ? m.ttf : '';
      const stall = m.stallDuration;
      return `${bvid},${ttf},${stall}`;
    });
    return [header, ...rows].join('\n');
  },

  /** Reset all collected metrics */
  reset() {
    for (const key of Object.keys(metrics)) delete metrics[key];
  },
};
