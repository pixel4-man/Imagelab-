import { ADSTERRA_ZONES, AutomaticAdsterraZoneDefinition } from './adsterraZones';

export type PlacementMountStatus = 'yes' | 'skipped_viewport' | 'no';
export type ScriptEventStatus = 'not_started' | 'pending' | 'load_fired' | 'error_fired';

export interface AdZoneDiagnosticLogEntry {
  event: string;
  status: string;
  detail: string;
  elapsedMs?: number;
  timestamp: string;
}

export interface AdZoneDiagnosticSnapshot {
  zoneNumber: 1 | 2 | 3 | 4 | 5;
  zoneKey: string;
  adId: string;
  placementId: string;
  placementName: string;
  slotId: string;
  dimensions: string;
  scriptUrl: string;
  deviceTarget: AutomaticAdsterraZoneDefinition['deviceTarget'];
  placementMounted: PlacementMountStatus;
  mountReason: string;
  anchorFound: boolean;
  anchorSummary: string;
  scriptElementCreated: boolean;
  scriptEvent: ScriptEventStatus;
  nestedIframeCreated: boolean;
  nestedIframeSrc: string;
  visibleCreativeDetected: boolean;
  visibleCreativeDetail: string;
  observedHttpStatus: string;
  removedByCleanup: boolean;
  cleanupReason: string;
  timedOut: boolean;
  currentStatus: string;
  outcomeCategory: string;
  errorMessage: string;
  events: AdZoneDiagnosticLogEntry[];
}

export function isAdDebugQueryEnabled(pathname?: string, search?: string): boolean {
  const pathVal =
    typeof pathname === 'string'
      ? pathname
      : typeof window !== 'undefined'
        ? window.location.pathname
        : '';
  const searchVal =
    typeof search === 'string'
      ? search
      : typeof window !== 'undefined'
        ? window.location.search
        : '';

  if (pathVal !== '/') return false;
  try {
    return new URLSearchParams(searchVal).get('addebug') === '1';
  } catch {
    return false;
  }
}

export function isAdDiagnosticRecordingEnabled(): boolean {
  return isAdDebugQueryEnabled() || Boolean(import.meta.env?.DEV);
}

function createInitialSnapshot(zone: AutomaticAdsterraZoneDefinition): AdZoneDiagnosticSnapshot {
  return {
    zoneNumber: zone.zoneNumber,
    zoneKey: zone.zoneKey,
    adId: zone.id,
    placementId: zone.defaultPlacementId,
    placementName: zone.defaultPlacementName,
    slotId: zone.defaultPlacementId.replace(/^plc_builtin_/, ''),
    dimensions: `${zone.widthPx}×${zone.heightPx}`,
    scriptUrl: zone.scriptUrl,
    deviceTarget: zone.deviceTarget,
    placementMounted: 'no',
    mountReason: 'Not evaluated yet',
    anchorFound: false,
    anchorSummary: 'Not inspected yet',
    scriptElementCreated: false,
    scriptEvent: 'not_started',
    nestedIframeCreated: false,
    nestedIframeSrc: '',
    visibleCreativeDetected: false,
    visibleCreativeDetail: '',
    observedHttpStatus: '',
    removedByCleanup: false,
    cleanupReason: '',
    timedOut: false,
    currentStatus: 'idle',
    outcomeCategory: '',
    errorMessage: '',
    events: [],
  };
}

const snapshotsByZoneKey = new Map<string, AdZoneDiagnosticSnapshot>(
  ADSTERRA_ZONES.map((z) => [z.zoneKey, createInitialSnapshot(z)])
);

const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function subscribeAdDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAdDiagnosticSnapshots(): AdZoneDiagnosticSnapshot[] {
  return ADSTERRA_ZONES.map(
    (z) => snapshotsByZoneKey.get(z.zoneKey) || createInitialSnapshot(z)
  );
}

export function updateZoneMountDiagnostic(params: {
  zoneKey: string;
  placementMounted: PlacementMountStatus;
  mountReason: string;
  anchorFound?: boolean;
  anchorSummary?: string;
  removedByCleanup?: boolean;
  cleanupReason?: string;
}) {
  if (!isAdDiagnosticRecordingEnabled()) return;
  const existing = snapshotsByZoneKey.get(params.zoneKey);
  if (!existing) return;

  const next: AdZoneDiagnosticSnapshot = {
    ...existing,
    placementMounted: params.placementMounted,
    mountReason: params.mountReason,
    anchorFound:
      typeof params.anchorFound === 'boolean' ? params.anchorFound : existing.anchorFound,
    anchorSummary: params.anchorSummary ?? existing.anchorSummary,
    removedByCleanup:
      typeof params.removedByCleanup === 'boolean'
        ? params.removedByCleanup
        : existing.removedByCleanup,
    cleanupReason:
      typeof params.cleanupReason === 'string'
        ? params.cleanupReason
        : existing.cleanupReason,
  };
  snapshotsByZoneKey.set(params.zoneKey, next);
  notifyListeners();
}

export function recordAdDiagnosticMilestone(params: {
  zoneKey: string;
  event: string;
  status?: string;
  outcomeCategory?: string;
  responseStatus?: string;
  detail: string;
  url?: string;
  elapsedMs?: number;
}) {
  if (!isAdDiagnosticRecordingEnabled()) return;
  const existing = snapshotsByZoneKey.get(params.zoneKey);
  if (!existing) return;

  const timestamp = new Date().toISOString();
  const next: AdZoneDiagnosticSnapshot = {
    ...existing,
    currentStatus: params.status || existing.currentStatus,
    outcomeCategory: params.outcomeCategory || existing.outcomeCategory,
    events: [
      ...existing.events.slice(-19),
      {
        event: params.event,
        status: params.status || '',
        detail: params.detail,
        elapsedMs: params.elapsedMs,
        timestamp,
      },
    ],
  };

  if (params.responseStatus) {
    next.observedHttpStatus = params.responseStatus;
  }

  switch (params.event) {
    case 'zone_mounted':
      next.placementMounted = 'yes';
      next.removedByCleanup = false;
      next.cleanupReason = '';
      break;
    case 'script_element_created':
      next.scriptElementCreated = true;
      break;
    case 'script_request_started':
      next.scriptElementCreated = true;
      if (next.scriptEvent === 'not_started') {
        next.scriptEvent = 'pending';
      }
      break;
    case 'script_loaded':
      next.scriptElementCreated = true;
      next.scriptEvent = 'load_fired';
      break;
    case 'script_failed':
      next.scriptElementCreated = true;
      if (next.scriptEvent !== 'load_fired') {
        next.scriptEvent = 'error_fired';
      }
      if (!next.errorMessage || params.detail) {
        next.errorMessage = params.detail;
      }
      break;
    case 'nested_iframe_created':
      next.nestedIframeCreated = true;
      if (params.url) {
        next.nestedIframeSrc = params.url;
      }
      break;
    case 'creative_rendered':
      if (params.status === 'loaded') {
        next.visibleCreativeDetected = true;
        next.visibleCreativeDetail = params.detail;
      } else if (params.status === 'preview_unsupported') {
        next.visibleCreativeDetected = false;
        next.visibleCreativeDetail =
          'Cross-origin nested frame mounted, but inner pixels cannot be verified across sandbox origin boundary.';
      }
      break;
    case 'empty_response':
      next.visibleCreativeDetected = false;
      if (!next.errorMessage) {
        next.errorMessage = params.detail;
      }
      break;
    case 'browser_restriction':
      if (!next.errorMessage || params.detail) {
        next.errorMessage = params.detail;
      }
      break;
    case 'timeout':
      next.timedOut = true;
      if (!next.errorMessage || params.detail) {
        next.errorMessage = params.detail;
      }
      break;
    case 'cleanup_unmounted':
      next.removedByCleanup = true;
      next.cleanupReason = params.detail;
      break;
  }

  snapshotsByZoneKey.set(params.zoneKey, next);
  notifyListeners();
}
