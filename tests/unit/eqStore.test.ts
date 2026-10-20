import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.mock('../../src/core/storage', () => ({
  storage: {
    getString: jest.fn(() => null),
    setString: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../src/native/AudioDSPModule', () => ({
  audioDSP: {
    updateGraphicEQ: jest.fn(),
    updatePEQFilter: jest.fn(),
    applyPreset: jest.fn(),
    setMode: jest.fn(),
    setEnabled: jest.fn(),
    reset: jest.fn(),
  },
}));

import {storage} from '../../src/core/storage';
import {audioDSP} from '../../src/native/AudioDSPModule';
import {EMOTION_PRESETS, useEQStore} from '../../src/store/eqStore';
import type {GraphicBands, PEQFilter} from '../../src/store/eqStore';

const initialState = useEQStore.getState();

describe('sound lab preset application and persistence', () => {
  beforeEach(() => {
    useEQStore.setState({...initialState});
    jest.clearAllMocks();
    jest.mocked(storage.getString).mockReturnValue(undefined);
  });

  it('applies a graphic preset when PEQ is active, retaining custom PEQ and the power switch', () => {
    const customFilters: PEQFilter[] = [
      {id: 7, type: 'LowShelf', frequency: 120, gain: 3, q: 0.7, enabled: true},
    ];
    useEQStore.setState({
      mode: 'parametric',
      enabled: false,
      peqFilters: customFilters,
    });
    useEQStore.getState().applyPreset('cyber_bass');
    const preset = EMOTION_PRESETS.find(item => item.id === 'cyber_bass')!;
    expect(useEQStore.getState()).toMatchObject({
      mode: 'graphic',
      enabled: false,
      activePresetId: 'cyber_bass',
      graphicBands: preset.graphicBands,
      peqFilters: customFilters,
    });
    expect(useEQStore.getState().graphicBands).not.toBe(preset.graphicBands);
    expect(audioDSP.applyPreset).toHaveBeenCalledWith(preset.graphicBands);
    expect(audioDSP.setMode).toHaveBeenCalledWith(0);
    expect(audioDSP.setEnabled).not.toHaveBeenCalled();
  });

  it('restores custom curves, filter IDs, mode and EQ power to native after hydration', async () => {
    const graphicBands: GraphicBands = [1, -2, 3, -4, 5, -6, 4, -3, 2, -1];
    const peqFilters: PEQFilter[] = [
      {
        id: 12,
        type: 'HighShelf',
        frequency: 6400,
        gain: -4,
        q: 0.8,
        enabled: true,
      },
      {id: 18, type: 'LowPass', frequency: 800, gain: 0, q: 2, enabled: false},
    ];
    const saved = {
      graphicBands,
      peqFilters,
      mode: 'parametric',
      enabled: false,
      activePresetId: null,
    };
    jest
      .mocked(storage.getString)
      .mockReturnValue(JSON.stringify({state: saved, version: 0}));
    await useEQStore.persist.rehydrate();
    expect(useEQStore.getState()).toMatchObject(saved);
    expect(audioDSP.updateGraphicEQ).toHaveBeenCalledWith(graphicBands);
    expect(audioDSP.updatePEQFilter).toHaveBeenNthCalledWith(
      1,
      0,
      2,
      6400,
      -4,
      0.8,
    );
    expect(audioDSP.updatePEQFilter).toHaveBeenNthCalledWith(
      2,
      1,
      0,
      1000,
      0,
      1,
    );
    expect(audioDSP.updatePEQFilter).toHaveBeenCalledTimes(8);
    expect(audioDSP.setMode).toHaveBeenCalledWith(1);
    expect(audioDSP.setEnabled).toHaveBeenCalledWith(false);
  });

  it('does not replace a saved selected preset curve with a newer definition on startup', async () => {
    const savedBands: GraphicBands = [2, 2, 1, 0, 0, 1, 2, 2, 1, 0];
    jest.mocked(storage.getString).mockReturnValue(
      JSON.stringify({
        state: {activePresetId: 'nyami', graphicBands: savedBands},
        version: 0,
      }),
    );
    await useEQStore.persist.rehydrate();
    expect(useEQStore.getState().activePresetId).toBe('nyami');
    expect(useEQStore.getState().graphicBands).toEqual(savedBands);
    expect(audioDSP.updateGraphicEQ).toHaveBeenCalledWith(savedBands);
  });

  it('resets to the graphic flat curve and clears native filter coefficients', () => {
    useEQStore.getState().applyPreset('crystal');
    useEQStore.getState().setMode('parametric');
    useEQStore.getState().resetToFlat();
    expect(useEQStore.getState()).toMatchObject({
      mode: 'graphic',
      activePresetId: 'flat',
      graphicBands: Array(10).fill(0),
    });
    expect(audioDSP.reset).toHaveBeenCalledTimes(1);
    expect(audioDSP.setMode).toHaveBeenLastCalledWith(0);
    expect(
      useEQStore
        .getState()
        .peqFilters.every(filter => !filter.enabled && filter.gain === 0),
    ).toBe(true);
  });

  it('clears native PEQ slots when a filter is disabled or removed despite nonsequential IDs', () => {
    useEQStore.setState({
      peqFilters: [
        {id: 4, type: 'Peak', frequency: 1000, gain: 5, q: 1, enabled: true},
        {
          id: 9,
          type: 'HighShelf',
          frequency: 6000,
          gain: 3,
          q: 1,
          enabled: true,
        },
      ],
    });
    useEQStore.getState().updatePEQFilter(4, {enabled: false});
    expect(audioDSP.updatePEQFilter).toHaveBeenCalledWith(0, 0, 1000, 0, 1);
    jest.clearAllMocks();
    useEQStore.getState().removeFilter(4);
    expect(audioDSP.updatePEQFilter).toHaveBeenNthCalledWith(
      1,
      0,
      2,
      6000,
      3,
      1,
    );
    expect(audioDSP.updatePEQFilter).toHaveBeenNthCalledWith(
      2,
      1,
      0,
      1000,
      0,
      1,
    );
  });

  it('marks bulk manual graphic edits as custom', () => {
    useEQStore.getState().applyPreset('nyami');
    useEQStore.getState().setGraphicBands(Array(10).fill(1) as GraphicBands);
    expect(useEQStore.getState().activePresetId).toBeNull();
  });

  it('retains every existing preset ID and keeps distinct legal curves with an unchanged flat reference', () => {
    expect(EMOTION_PRESETS.map(preset => preset.id)).toEqual([
      'flat',
      'nyami',
      'cat_bass',
      'cyber_bass',
      'girl_band',
      'idol_stage',
      'whisper',
      'midnight_radio',
      'tokyo_rain',
      'vaporwave',
      'lofi_cafe',
      'cyberpunk',
      'neon_drive',
      'live',
      'hall',
      '8bit',
      'crystal',
    ]);
    expect(EMOTION_PRESETS[0].graphicBands).toEqual(Array(10).fill(0));
    const curves = EMOTION_PRESETS.map(preset => preset.graphicBands!);
    expect(new Set(curves.map(curve => curve.join(','))).size).toBe(
      curves.length,
    );
    for (const curve of curves) {
      expect(curve).toHaveLength(10);
      expect(
        curve.every(gain => Number.isFinite(gain) && gain >= -12 && gain <= 12),
      ).toBe(true);
    }
  });
});
