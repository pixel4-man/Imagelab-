import { AdRecord, VisualPlacementRecord } from '../types/ads';
import { getBuiltinAdsterraState } from './adsterraZones';

export interface ActiveAdState {
  placements: VisualPlacementRecord[];
  ads: AdRecord[];
}

/**
 * Loads the predefined source-code Adsterra zone configuration without
 * depending on Ads Manager, admin-created records, or Firestore ad management.
 */
export function getPredefinedActiveAdState(): ActiveAdState {
  return getBuiltinAdsterraState();
}

export async function fetchPublicActiveAds(): Promise<ActiveAdState> {
  return getPredefinedActiveAdState();
}
