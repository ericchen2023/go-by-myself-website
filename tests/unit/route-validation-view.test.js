import { describe, expect, it, vi } from 'vitest';
import { routeValidationView } from '../../src/operator/route-validation-view.js';

function workspace() {
  return {
    capabilityEnabled: false,
    mappingStatus: 'unapproved',
    vehicles: [{ id: 'vehicle-1', code: 'GBM-01', displayName: 'GBM-01 · 綠白識別', operationalStatus: 'available' }],
    legs: [],
    activeRun: {
      routeJob: {
        id: 'job-1', state: 'running', fromStopCode: 'LIBRARY', toStopCode: 'HSS2', currentLegIndex: 0, legCount: 1
      },
      vehicle: {
        state: 'moving', connectivity: 'online', quality: 'valid', battery: { voltageV: 23.7, percent: null }
      },
      route: { legId: 'A_B', segmentId: 'edge-hss2-hss1', progress: 0.42, lateralM: 0.03 },
      diagnostics: { frameId: 'site-v1', x: -5.5, y: -2.4, heading: 30, bootId: 'boot', sequence: 10 }
    }
  };
}

describe('protected route validation workspace', () => {
  it('shows four public stops and never claims a delivery completed', () => {
    const view = routeValidationView({
      workspace: workspace(),
      selection: { vehicleId: '', legId: '' },
      busy: false,
      onSelection: vi.fn(),
      onStart: vi.fn(),
      onStop: vi.fn()
    });
    document.body.replaceChildren(view);
    expect(document.querySelectorAll('.map-stop')).toHaveLength(4);
    expect(view.textContent).toContain('空載');
    expect(view.textContent).not.toContain('投遞完成');
    expect(view.textContent).toContain('23.7 V（百分比尚未校正）');
  });

  it('keeps the physical start action disabled until mapping and capability are approved', () => {
    const current = workspace();
    current.activeRun = null;
    const view = routeValidationView({
      workspace: current,
      selection: { vehicleId: 'vehicle-1', legId: '' },
      busy: false,
      onSelection: vi.fn(),
      onStart: vi.fn(),
      onStop: vi.fn()
    });
    const start = view.querySelector('button');
    expect(start.disabled).toBe(true);
    expect(view.textContent).toContain('A／B／C／D');
  });
});
