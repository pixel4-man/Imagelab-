import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { OperationType, handleFirestoreError } from './firestoreErrors';
import {
  type ApiCallResult,
  type TokenGetter,
  callJsonApiWithFallback as rawCallJsonApiWithFallback,
  isJsonContentType,
  resolveApiUrl,
} from './adsApiClient';
import {
  AdPayload,
  AdRecord,
  AdType,
  BUILT_IN_AD_TYPES,
  VisualPlacementPayload,
  VisualPlacementRecord,
  findDuplicatePlacement,
  normalizePageRoute,
  validateAdPayload,
  validatePlacementPayload,
} from '../types/ads';

export { type ApiCallResult, type TokenGetter, isJsonContentType, resolveApiUrl };

export interface ActiveAdState {
  placements: VisualPlacementRecord[];
  ads: AdRecord[];
}

function serializeTimestamp(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (
    val &&
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof val === 'string' && val ? val : new Date().toISOString();
}

function mapDocToPlacement(id: string, d: Record<string, unknown>): VisualPlacementRecord {
  const rawType = String(d.adType || 'responsive_banner') as AdType;
  return {
    id,
    name: String(d.name || ''),
    pageRoute: normalizePageRoute(String(d.pageRoute || '/')),
    slotId: String(d.slotId || ''),
    selector: String(d.selector || ''),
    elementInfo: String(d.elementInfo || ''),
    position: d.position === 'before' || d.position === 'inside' ? d.position : 'after',
    width: typeof d.width === 'string' && d.width.trim() ? d.width.trim() : 'auto',
    height: typeof d.height === 'string' && d.height.trim() ? d.height.trim() : 'auto',
    adType: BUILT_IN_AD_TYPES.includes(rawType) ? rawType : 'responsive_banner',
    status: d.status === 'disabled' ? 'disabled' : 'active',
    priority: typeof d.priority === 'number' && Number.isFinite(d.priority) ? d.priority : 10,
    anchorMissing: Boolean(d.anchorMissing),
    createdByUid: String(d.createdByUid || ''),
    createdAt: serializeTimestamp(d.createdAt),
    updatedAt: serializeTimestamp(d.updatedAt),
  };
}

function mapDocToAd(
  id: string,
  d: Record<string, unknown>,
  placementNameMap?: Map<string, string>
): AdRecord {
  const rawType = String(d.adType || 'banner') as AdType;
  const placementId = String(d.placementId || '');
  return {
    id,
    name: String(d.name || ''),
    provider: String(d.provider || ''),
    adType: BUILT_IN_AD_TYPES.includes(rawType) ? rawType : 'banner',
    scriptCode: String(d.scriptCode || ''),
    placementId,
    placementName:
      placementNameMap?.get(placementId) || String(d.placementName || d.placement || ''),
    width: typeof d.width === 'string' && d.width.trim() ? d.width.trim() : 'auto',
    height: typeof d.height === 'string' && d.height.trim() ? d.height.trim() : 'auto',
    status: d.status === 'disabled' ? 'disabled' : 'active',
    priority: typeof d.priority === 'number' && Number.isFinite(d.priority) ? d.priority : 10,
    createdAt: serializeTimestamp(d.createdAt),
    updatedAt: serializeTimestamp(d.updatedAt),
    updatedByUid: typeof d.updatedByUid === 'string' ? d.updatedByUid : undefined,
  };
}

async function resolveAuthToken(getIdToken?: TokenGetter, forceRefresh = false): Promise<string | null> {
  if (forceRefresh && auth?.currentUser) {
    try {
      return await auth.currentUser.getIdToken(true);
    } catch {
      return null;
    }
  }
  if (getIdToken) {
    try {
      const tok = await getIdToken(forceRefresh);
      if (tok) return tok;
    } catch {
      // Try auth.currentUser directly below
    }
  }
  if (auth?.currentUser) {
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }
  return null;
}

export async function callJsonApiWithFallback<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    requireAuth?: boolean;
    getIdToken?: TokenGetter;
    cache?: RequestCache;
  } = {}
): Promise<ApiCallResult<T>> {
  return rawCallJsonApiWithFallback<T>(path, {
    ...options,
    getIdToken: options.requireAuth
      ? (forceRefresh) => resolveAuthToken(options.getIdToken, Boolean(forceRefresh))
      : options.getIdToken,
  });
}

function requireClientFirestore() {
  if (!db) {
    throw new Error('Firestore database is not configured in this environment.');
  }
  return db;
}

function requireClientUserUid(): string {
  const uid = auth?.currentUser?.uid;
  if (!uid) {
    throw new Error('Authentication required. Please sign in again.');
  }
  return uid;
}

async function listClientPlacements(): Promise<VisualPlacementRecord[]> {
  const firestoreDb = requireClientFirestore();
  try {
    const snap = await getDocs(collection(firestoreDb, 'adPlacements'));
    return snap.docs
      .map((d) => mapDocToPlacement(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)
      );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'adPlacements');
  }
}

async function listClientAds(placementNameMap?: Map<string, string>): Promise<AdRecord[]> {
  const firestoreDb = requireClientFirestore();
  try {
    const snap = await getDocs(collection(firestoreDb, 'ads'));
    return snap.docs
      .map((d) => mapDocToAd(d.id, d.data() as Record<string, unknown>, placementNameMap))
      .sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)
      );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'ads');
  }
}

async function syncClientPublicAdSlot(
  ad: AdRecord,
  placement: VisualPlacementRecord | null
): Promise<void> {
  const firestoreDb = requireClientFirestore();
  const publicRef = doc(firestoreDb, 'publicAdSlots', ad.id);

  const shouldBePublic =
    ad.status === 'active' &&
    ad.scriptCode.trim().length >= 5 &&
    placement !== null &&
    placement.status === 'active';

  if (!shouldBePublic || !placement) {
    try {
      await deleteDoc(publicRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `publicAdSlots/${ad.id}`);
    }
    return;
  }

  const effectiveWidth =
    ad.width && ad.width !== 'auto' ? ad.width : placement.width || 'auto';
  const effectiveHeight =
    ad.height && ad.height !== 'auto' ? ad.height : placement.height || 'auto';

  const publicDoc = {
    id: ad.id,
    adId: ad.id,
    placementId: placement.id,
    placementName: placement.name || placement.id,
    pageRoute: placement.pageRoute,
    slotId: placement.slotId,
    selector: placement.selector,
    position: placement.position,
    placementPriority: placement.priority,
    name: ad.name,
    provider: ad.provider,
    adType: ad.adType,
    scriptCode: ad.scriptCode,
    width: effectiveWidth,
    height: effectiveHeight,
    priority: ad.priority,
    status: 'active',
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(publicRef, publicDoc);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `publicAdSlots/${ad.id}`);
  }
}

export async function fetchAdminWorkspaceData(
  getIdToken?: TokenGetter
): Promise<{ placements: VisualPlacementRecord[]; ads: AdRecord[] }> {
  const [plcRes, adsRes] = await Promise.all([
    callJsonApiWithFallback<{ placements?: VisualPlacementRecord[] }>('/api/admin/placements', {
      requireAuth: true,
      getIdToken,
      cache: 'no-store',
    }),
    callJsonApiWithFallback<{ ads?: AdRecord[] }>('/api/admin/ads', {
      requireAuth: true,
      getIdToken,
      cache: 'no-store',
    }),
  ]);

  if (!plcRes.apiUnavailable && !adsRes.apiUnavailable) {
    return {
      placements: Array.isArray(plcRes.data?.placements) ? plcRes.data!.placements : [],
      ads: Array.isArray(adsRes.data?.ads) ? adsRes.data!.ads : [],
    };
  }

  requireClientUserUid();
  const placements = await listClientPlacements();
  const nameMap = new Map(placements.map((p) => [p.id, p.name]));
  const ads = await listClientAds(nameMap);
  return { placements, ads };
}

export async function createVisualPlacement(
  payload: VisualPlacementPayload,
  getIdToken?: TokenGetter
): Promise<VisualPlacementRecord> {
  const check = validatePlacementPayload(payload);
  if (!check.valid || !check.sanitized) {
    throw new Error(check.error || 'Invalid visual placement settings.');
  }

  const apiResult = await callJsonApiWithFallback<{ placement?: VisualPlacementRecord }>(
    '/api/admin/placements',
    {
      method: 'POST',
      body: check.sanitized,
      requireAuth: true,
      getIdToken,
    }
  );

  if (!apiResult.apiUnavailable) {
    if (!apiResult.data?.placement) {
      throw new Error('Backend did not return the saved placement record.');
    }
    return apiResult.data.placement;
  }

  const firestoreDb = requireClientFirestore();
  const uid = requireClientUserUid();
  const existing = await listClientPlacements();
  const duplicate = findDuplicatePlacement(check.sanitized, existing);
  if (duplicate) {
    throw new Error(
      `A placement named "${duplicate.name}" already exists for this area (${duplicate.pageRoute}, ${duplicate.position}). Edit the existing placement instead.`
    );
  }

  const placementId = `plc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const docRef = doc(firestoreDb, 'adPlacements', placementId);

  try {
    await setDoc(docRef, {
      id: placementId,
      ...check.sanitized,
      anchorMissing: false,
      createdByUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `adPlacements/${placementId}`);
  }

  try {
    const savedSnap = await getDocFromServer(docRef);
    if (!savedSnap.exists()) {
      throw new Error('Placement write could not be verified on Firestore.');
    }
    return mapDocToPlacement(savedSnap.id, savedSnap.data() as Record<string, unknown>);
  } catch (err) {
    if (err instanceof Error && err.message.includes('verified on Firestore')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.GET, `adPlacements/${placementId}`);
  }
}

export async function updateVisualPlacement(
  placementId: string,
  updates: Partial<VisualPlacementPayload> & { anchorMissing?: boolean },
  getIdToken?: TokenGetter
): Promise<VisualPlacementRecord> {
  const apiResult = await callJsonApiWithFallback<{ placement?: VisualPlacementRecord }>(
    `/api/admin/placements/${encodeURIComponent(placementId)}`,
    {
      method: 'PATCH',
      body: updates,
      requireAuth: true,
      getIdToken,
    }
  );

  if (!apiResult.apiUnavailable) {
    if (!apiResult.data?.placement) {
      throw new Error('Backend did not return the updated placement record.');
    }
    return apiResult.data.placement;
  }

  const firestoreDb = requireClientFirestore();
  requireClientUserUid();
  const docRef = doc(firestoreDb, 'adPlacements', placementId);

  let existingSnap;
  try {
    existingSnap = await getDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `adPlacements/${placementId}`);
  }

  if (!existingSnap.exists()) {
    throw new Error('Visual placement not found.');
  }

  const existingRecord = mapDocToPlacement(
    existingSnap.id,
    existingSnap.data() as Record<string, unknown>
  );

  const merged: VisualPlacementPayload = {
    name: updates.name ?? existingRecord.name,
    pageRoute: updates.pageRoute ?? existingRecord.pageRoute,
    slotId: updates.slotId ?? existingRecord.slotId,
    selector: updates.selector ?? existingRecord.selector,
    elementInfo: updates.elementInfo ?? existingRecord.elementInfo,
    position: updates.position ?? existingRecord.position,
    width: updates.width ?? existingRecord.width,
    height: updates.height ?? existingRecord.height,
    adType: updates.adType ?? existingRecord.adType,
    status: updates.status ?? existingRecord.status,
    priority: updates.priority ?? existingRecord.priority,
  };

  const check = validatePlacementPayload(merged);
  if (!check.valid || !check.sanitized) {
    throw new Error(check.error || 'Invalid visual placement update.');
  }

  const allPlacements = await listClientPlacements();
  const duplicate = findDuplicatePlacement(check.sanitized, allPlacements, placementId);
  if (duplicate) {
    throw new Error(
      `Another placement ("${duplicate.name}") already targets this exact route and position.`
    );
  }

  const nextAnchorMissing =
    typeof updates.anchorMissing === 'boolean'
      ? updates.anchorMissing
      : Boolean(existingRecord.anchorMissing);

  try {
    await updateDoc(docRef, {
      ...check.sanitized,
      anchorMissing: nextAnchorMissing,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `adPlacements/${placementId}`);
  }

  let updatedPlacement: VisualPlacementRecord;
  try {
    const verifiedSnap = await getDocFromServer(docRef);
    updatedPlacement = verifiedSnap.exists()
      ? mapDocToPlacement(verifiedSnap.id, verifiedSnap.data() as Record<string, unknown>)
      : {
          ...existingRecord,
          ...check.sanitized,
          anchorMissing: nextAnchorMissing,
          updatedAt: new Date().toISOString(),
        };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `adPlacements/${placementId}`);
  }

  // Sync linked ads placementName and publicAdSlots visibility/dimensions
  try {
    const linkedSnap = await getDocs(
      query(collection(firestoreDb, 'ads'), where('placementId', '==', placementId))
    );
    for (const adDoc of linkedSnap.docs) {
      const adRecord = mapDocToAd(adDoc.id, adDoc.data() as Record<string, unknown>);
      if (check.sanitized.name !== existingRecord.name) {
        await updateDoc(adDoc.ref, {
          placementName: check.sanitized.name,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      await syncClientPublicAdSlot(
        { ...adRecord, placementName: check.sanitized.name },
        updatedPlacement
      );
    }
  } catch {
    // Placement update already verified; linked sync best-effort
  }

  return updatedPlacement;
}

export async function updateVisualPlacementAnchorStatus(
  placementId: string,
  anchorMissing: boolean,
  getIdToken?: TokenGetter
): Promise<void> {
  const apiResult = await callJsonApiWithFallback<{ placement?: VisualPlacementRecord }>(
    `/api/admin/placements/${encodeURIComponent(placementId)}`,
    {
      method: 'PATCH',
      body: { anchorMissing },
      requireAuth: true,
      getIdToken,
    }
  );
  if (!apiResult.apiUnavailable) return;

  if (!db || !auth?.currentUser) return;
  try {
    await updateDoc(doc(db, 'adPlacements', placementId), {
      anchorMissing,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking anchor status diagnostic sync
  }
}

export async function deleteVisualPlacement(
  placementId: string,
  getIdToken?: TokenGetter
): Promise<void> {
  const apiResult = await callJsonApiWithFallback<{ deleted?: boolean }>(
    `/api/admin/placements/${encodeURIComponent(placementId)}`,
    {
      method: 'DELETE',
      requireAuth: true,
      getIdToken,
    }
  );
  if (!apiResult.apiUnavailable) return;

  const firestoreDb = requireClientFirestore();
  requireClientUserUid();

  try {
    const publicSlotsSnap = await getDocs(
      query(collection(firestoreDb, 'publicAdSlots'), where('placementId', '==', placementId))
    );
    for (const slotDoc of publicSlotsSnap.docs) {
      await deleteDoc(slotDoc.ref).catch(() => {});
    }
  } catch {
    // Continue removing placement even if public slots query returns empty
  }

  try {
    await deleteDoc(doc(firestoreDb, 'adPlacements', placementId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `adPlacements/${placementId}`);
  }
}

export async function createAdvertisement(
  payload: AdPayload,
  getIdToken?: TokenGetter
): Promise<AdRecord> {
  const check = validateAdPayload(payload);
  if (!check.valid || !check.sanitized) {
    throw new Error(check.error || 'Invalid advertisement configuration.');
  }

  const apiResult = await callJsonApiWithFallback<{ ad?: AdRecord }>('/api/admin/ads', {
    method: 'POST',
    body: check.sanitized,
    requireAuth: true,
    getIdToken,
  });

  if (!apiResult.apiUnavailable) {
    if (!apiResult.data?.ad) {
      throw new Error('Backend did not return the saved advertisement.');
    }
    return apiResult.data.ad;
  }

  const firestoreDb = requireClientFirestore();
  const uid = requireClientUserUid();

  let placementSnap;
  try {
    placementSnap = await getDoc(doc(firestoreDb, 'adPlacements', check.sanitized.placementId));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.GET,
      `adPlacements/${check.sanitized.placementId}`
    );
  }

  if (!placementSnap.exists()) {
    throw new Error(
      'Selected placement does not exist. Select a placement on the website first.'
    );
  }

  const placement = mapDocToPlacement(
    placementSnap.id,
    placementSnap.data() as Record<string, unknown>
  );

  const adId = `ad_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const adRef = doc(firestoreDb, 'ads', adId);

  try {
    await setDoc(adRef, {
      id: adId,
      ...check.sanitized,
      placementName: placement.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `ads/${adId}`);
  }

  let savedAd: AdRecord;
  try {
    const savedSnap = await getDocFromServer(adRef);
    savedAd = savedSnap.exists()
      ? mapDocToAd(savedSnap.id, savedSnap.data() as Record<string, unknown>)
      : {
          id: adId,
          ...check.sanitized,
          placementName: placement.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedByUid: uid,
        };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `ads/${adId}`);
  }

  await syncClientPublicAdSlot(savedAd, placement);
  return savedAd;
}

export async function updateAdvertisement(
  adId: string,
  updates: Partial<AdPayload>,
  getIdToken?: TokenGetter
): Promise<AdRecord> {
  const apiResult = await callJsonApiWithFallback<{ ad?: AdRecord }>(
    `/api/admin/ads/${encodeURIComponent(adId)}`,
    {
      method: 'PATCH',
      body: updates,
      requireAuth: true,
      getIdToken,
    }
  );

  if (!apiResult.apiUnavailable) {
    if (!apiResult.data?.ad) {
      throw new Error('Backend did not return the updated advertisement.');
    }
    return apiResult.data.ad;
  }

  const firestoreDb = requireClientFirestore();
  const uid = requireClientUserUid();
  const adRef = doc(firestoreDb, 'ads', adId);

  let existingSnap;
  try {
    existingSnap = await getDoc(adRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `ads/${adId}`);
  }

  if (!existingSnap.exists()) {
    throw new Error('Advertisement not found.');
  }

  const existingAd = mapDocToAd(existingSnap.id, existingSnap.data() as Record<string, unknown>);
  const merged: AdPayload = {
    name: updates.name ?? existingAd.name,
    provider: updates.provider ?? existingAd.provider,
    adType: updates.adType ?? existingAd.adType,
    scriptCode: updates.scriptCode ?? existingAd.scriptCode,
    placementId: updates.placementId ?? existingAd.placementId,
    width: updates.width ?? existingAd.width,
    height: updates.height ?? existingAd.height,
    status: updates.status ?? existingAd.status,
    priority: updates.priority ?? existingAd.priority,
  };

  const check = validateAdPayload(merged);
  if (!check.valid || !check.sanitized) {
    throw new Error(check.error || 'Invalid advertisement update.');
  }

  let placementSnap;
  try {
    placementSnap = await getDoc(doc(firestoreDb, 'adPlacements', check.sanitized.placementId));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.GET,
      `adPlacements/${check.sanitized.placementId}`
    );
  }

  if (!placementSnap.exists()) {
    throw new Error('Target placement does not exist.');
  }

  const placement = mapDocToPlacement(
    placementSnap.id,
    placementSnap.data() as Record<string, unknown>
  );

  try {
    await updateDoc(adRef, {
      ...check.sanitized,
      placementName: placement.name,
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `ads/${adId}`);
  }

  let updatedAd: AdRecord;
  try {
    const savedSnap = await getDocFromServer(adRef);
    updatedAd = savedSnap.exists()
      ? mapDocToAd(savedSnap.id, savedSnap.data() as Record<string, unknown>)
      : {
          ...existingAd,
          ...check.sanitized,
          placementName: placement.name,
          updatedAt: new Date().toISOString(),
          updatedByUid: uid,
        };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `ads/${adId}`);
  }

  await syncClientPublicAdSlot(updatedAd, placement);
  return updatedAd;
}

export async function deleteAdvertisement(
  adId: string,
  getIdToken?: TokenGetter
): Promise<void> {
  const apiResult = await callJsonApiWithFallback<{ deleted?: boolean }>(
    `/api/admin/ads/${encodeURIComponent(adId)}`,
    {
      method: 'DELETE',
      requireAuth: true,
      getIdToken,
    }
  );
  if (!apiResult.apiUnavailable) return;

  const firestoreDb = requireClientFirestore();
  requireClientUserUid();

  try {
    await deleteDoc(doc(firestoreDb, 'publicAdSlots', adId));
  } catch {
    // Public slot may not exist if ad was disabled
  }

  try {
    await deleteDoc(doc(firestoreDb, 'ads', adId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `ads/${adId}`);
  }
}

export async function fetchPublicActiveAds(): Promise<ActiveAdState> {
  try {
    const apiResult = await callJsonApiWithFallback<{
      placements?: VisualPlacementRecord[];
      ads?: AdRecord[];
    }>('/api/ads/active', { cache: 'no-store' });

    if (!apiResult.apiUnavailable && apiResult.data) {
      return {
        placements: Array.isArray(apiResult.data.placements) ? apiResult.data.placements : [],
        ads: Array.isArray(apiResult.data.ads) ? apiResult.data.ads : [],
      };
    }
  } catch {
    // Fall back to active-only publicAdSlots query below
  }

  if (!db) {
    return { placements: [], ads: [] };
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'publicAdSlots'), where('status', '==', 'active'))
    );
    const placementMap = new Map<string, VisualPlacementRecord>();
    const ads: AdRecord[] = [];

    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const placementId = String(data.placementId || '');
      if (!placementId) continue;

      const updatedAt = serializeTimestamp(data.updatedAt);
      const adType = BUILT_IN_AD_TYPES.includes(data.adType as AdType)
        ? (data.adType as AdType)
        : 'responsive_banner';

      if (!placementMap.has(placementId)) {
        placementMap.set(placementId, {
          id: placementId,
          name: String(data.placementName || placementId),
          pageRoute: normalizePageRoute(String(data.pageRoute || '/')),
          slotId: String(data.slotId || ''),
          selector: String(data.selector || ''),
          elementInfo: String(data.placementName || ''),
          position: data.position === 'before' || data.position === 'inside' ? data.position : 'after',
          width: typeof data.width === 'string' && data.width.trim() ? data.width.trim() : 'auto',
          height: typeof data.height === 'string' && data.height.trim() ? data.height.trim() : 'auto',
          adType,
          status: 'active',
          priority:
            typeof data.placementPriority === 'number' && Number.isFinite(data.placementPriority)
              ? data.placementPriority
              : 10,
          createdByUid: '',
          createdAt: updatedAt,
          updatedAt,
        });
      }

      ads.push({
        id: String(data.adId || d.id),
        name: String(data.name || ''),
        provider: String(data.provider || ''),
        adType,
        scriptCode: String(data.scriptCode || ''),
        placementId,
        placementName: String(data.placementName || placementId),
        width: typeof data.width === 'string' && data.width.trim() ? data.width.trim() : 'auto',
        height: typeof data.height === 'string' && data.height.trim() ? data.height.trim() : 'auto',
        status: 'active',
        priority: typeof data.priority === 'number' && Number.isFinite(data.priority) ? data.priority : 10,
        createdAt: updatedAt,
        updatedAt,
      });
    }

    const placements = Array.from(placementMap.values()).sort((a, b) =>
      a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)
    );
    ads.sort((a, b) =>
      a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)
    );

    return { placements, ads };
  } catch {
    return { placements: [], ads: [] };
  }
}
