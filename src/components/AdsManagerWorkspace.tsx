import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Edit3,
  Eye,
  ExternalLink,
  MapPin,
  Megaphone,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { usePlacementSelector } from '../context/PlacementSelectorContext';
import {
  AD_TYPES,
  AdInsertPosition,
  AdPayload,
  AdRecord,
  AdStatus,
  AdType,
  DIMENSION_PRESETS,
  VisualPlacementRecord,
  formatReadableError,
  getAdTypeLabel,
} from '../types/ads';
import {
  createAdvertisement,
  deleteAdvertisement,
  deleteVisualPlacement,
  fetchAdminWorkspaceData,
  updateAdvertisement,
  updateVisualPlacement,
} from '../lib/adsPersistence';
import { AdSlot, notifyActiveAdsUpdated } from './AdSlot';

interface AdsManagerWorkspaceProps {
  onCountChange?: (counts: { total: number; active: number; placements: number }) => void;
}

const DEFAULT_AD_FORM: AdPayload = {
  name: '',
  provider: '',
  adType: 'responsive_banner',
  scriptCode: '',
  placementId: '',
  width: 'auto',
  height: 'auto',
  status: 'active',
  priority: 10,
};

function formatTimestamp(iso: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdsManagerWorkspace({ onCountChange }: AdsManagerWorkspaceProps) {
  const { getIdToken } = useAuth();
  const { showToast } = useApp();
  const { enterSelectionMode } = usePlacementSelector();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [placements, setPlacements] = useState<VisualPlacementRecord[]>([]);
  const [ads, setAds] = useState<AdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters for Advertisements
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AdStatus>('all');
  const [placementFilter, setPlacementFilter] = useState<string>('all');

  // Create / Edit Ad Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AdPayload>(DEFAULT_AD_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit Placement Modal
  const [editingPlacement, setEditingPlacement] = useState<VisualPlacementRecord | null>(null);
  const [placementEditForm, setPlacementEditForm] = useState<{
    name: string;
    position: AdInsertPosition;
    adType: AdType;
    width: string;
    height: string;
    priority: number;
    status: AdStatus;
  }>({
    name: '',
    position: 'after',
    adType: 'responsive_banner',
    width: 'auto',
    height: 'auto',
    priority: 10,
    status: 'active',
  });
  const [placementEditError, setPlacementEditError] = useState<string | null>(null);
  const [savingPlacementEdit, setSavingPlacementEdit] = useState(false);

  // Previews & Delete Confirms
  const [previewAd, setPreviewAd] = useState<AdRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdRecord | null>(null);
  const [deletePlacementTarget, setDeletePlacementTarget] = useState<VisualPlacementRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Row quick edits for Ads
  const [rowDrafts, setRowDrafts] = useState<
    Record<string, { placementId: string; priority: number }>
  >({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { placements: nextPlacements, ads: nextAds } =
        await fetchAdminWorkspaceData(getIdToken);
      setPlacements(nextPlacements);
      setAds(nextAds);

      const drafts: Record<string, { placementId: string; priority: number }> = {};
      for (const ad of nextAds) {
        drafts[ad.id] = { placementId: ad.placementId, priority: ad.priority };
      }
      setRowDrafts(drafts);

      onCountChange?.({
        total: nextAds.length,
        active: nextAds.filter((a) => a.status === 'active').length,
        placements: nextPlacements.length,
      });
    } catch (err) {
      setLoadError(
        formatReadableError(err, 'Unable to load visual placements and advertisements.')
      );
    } finally {
      setLoading(false);
    }
  }, [getIdToken, onCountChange]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Support deep-linking from Visual Placement Confirmation -> "Create Ad Here"
  useEffect(() => {
    const preselectedPlacementId = searchParams.get('placementId');
    if (!preselectedPlacementId || placements.length === 0) return;
    const matched = placements.find((p) => p.id === preselectedPlacementId);
    if (matched) {
      setEditingAdId(null);
      setFormState({
        ...DEFAULT_AD_FORM,
        placementId: matched.id,
        adType: matched.adType || DEFAULT_AD_FORM.adType,
        width: matched.width || DEFAULT_AD_FORM.width,
        height: matched.height || DEFAULT_AD_FORM.height,
      });
      setFormError(null);
      setModalOpen(true);

      const next = new URLSearchParams(searchParams);
      next.delete('placementId');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, placements]);

  const placementMap = useMemo(() => {
    const map = new Map<string, VisualPlacementRecord>();
    for (const p of placements) {
      map.set(p.id, p);
    }
    return map;
  }, [placements]);

  const startVisualSelection = (route = '/') => {
    enterSelectionMode();
    navigate(route);
  };

  const filteredAds = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return ads.filter((ad) => {
      if (statusFilter !== 'all' && ad.status !== statusFilter) return false;
      if (placementFilter !== 'all' && ad.placementId !== placementFilter) return false;
      if (!q) return true;
      const plcName = placementMap.get(ad.placementId)?.name || ad.placementName || '';
      return (
        ad.name.toLowerCase().includes(q) ||
        ad.provider.toLowerCase().includes(q) ||
        plcName.toLowerCase().includes(q)
      );
    });
  }, [ads, searchTerm, statusFilter, placementFilter, placementMap]);

  const openCreateModal = () => {
    const first = placements[0];
    setEditingAdId(null);
    setFormState({
      ...DEFAULT_AD_FORM,
      placementId: first?.id || '',
      adType: first?.adType || DEFAULT_AD_FORM.adType,
      width: first?.width || DEFAULT_AD_FORM.width,
      height: first?.height || DEFAULT_AD_FORM.height,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (ad: AdRecord) => {
    setEditingAdId(ad.id);
    setFormState({
      name: ad.name,
      provider: ad.provider,
      adType: ad.adType,
      scriptCode: ad.scriptCode,
      placementId: ad.placementId,
      width: ad.width,
      height: ad.height,
      status: ad.status,
      priority: ad.priority,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveAd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formState.placementId) {
      setFormError('Select a saved visual placement (or select one on the website first).');
      return;
    }
    setSaving(true);
    try {
      if (editingAdId) {
        await updateAdvertisement(editingAdId, formState, getIdToken);
      } else {
        await createAdvertisement(formState, getIdToken);
      }

      setModalOpen(false);
      showToast(editingAdId ? 'Advertisement updated' : 'Advertisement created', 'teal');
      notifyActiveAdsUpdated();
      await loadWorkspaceData();
    } catch (err) {
      setFormError(formatReadableError(err, 'Could not save advertisement.'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAdStatus = async (ad: AdRecord) => {
    const nextStatus: AdStatus = ad.status === 'active' ? 'disabled' : 'active';
    try {
      await updateAdvertisement(ad.id, { status: nextStatus }, getIdToken);
      showToast(
        nextStatus === 'active' ? 'Advertisement enabled' : 'Advertisement disabled',
        nextStatus === 'active' ? 'teal' : 'deep'
      );
      notifyActiveAdsUpdated();
      await loadWorkspaceData();
    } catch (err) {
      showToast(
        formatReadableError(err, 'Unable to toggle advertisement status.'),
        'terracotta'
      );
    }
  };

  const handleSaveRowQuickChanges = async (ad: AdRecord) => {
    const draft = rowDrafts[ad.id];
    if (!draft) return;
    setSavingRowId(ad.id);
    try {
      await updateAdvertisement(
        ad.id,
        {
          placementId: draft.placementId,
          priority: draft.priority,
        },
        getIdToken
      );
      showToast('Placement & priority updated', 'teal');
      notifyActiveAdsUpdated();
      await loadWorkspaceData();
    } catch (err) {
      showToast(
        formatReadableError(err, 'Unable to save placement assignment.'),
        'terracotta'
      );
    } finally {
      setSavingRowId(null);
    }
  };

  const handleConfirmDeleteAd = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAdvertisement(deleteTarget.id, getIdToken);
      setDeleteTarget(null);
      showToast('Advertisement deleted', 'deep');
      notifyActiveAdsUpdated();
      await loadWorkspaceData();
    } catch (err) {
      showToast(formatReadableError(err, 'Unable to delete advertisement.'), 'terracotta');
    } finally {
      setDeleting(false);
    }
  };

  // Visual Placement Actions
  const openEditPlacement = (plc: VisualPlacementRecord) => {
    setEditingPlacement(plc);
    setPlacementEditError(null);
    setPlacementEditForm({
      name: plc.name,
      position: plc.position,
      adType: plc.adType || 'responsive_banner',
      width: plc.width || 'auto',
      height: plc.height || 'auto',
      priority: plc.priority,
      status: plc.status,
    });
  };

  const handleSavePlacementEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlacement) return;
    setPlacementEditError(null);
    setSavingPlacementEdit(true);
    try {
      await updateVisualPlacement(editingPlacement.id, placementEditForm, getIdToken);
      setEditingPlacement(null);
      showToast('Placement updated', 'teal');
      notifyActiveAdsUpdated();
      await loadWorkspaceData();
    } catch (err) {
      const message = formatReadableError(err, 'Could not update visual placement.');
      setPlacementEditError(message);
      showToast(message, 'terracotta');
    } finally {
      setSavingPlacementEdit(false);
    }
  };

  const handleTogglePlacementStatus = async (plc: VisualPlacementRecord) => {
    const nextStatus: AdStatus = plc.status === 'active' ? 'disabled' : 'active';
    try {
      await updateVisualPlacement(plc.id, { status: nextStatus }, getIdToken);
      showToast(
        nextStatus === 'active' ? 'Placement enabled' : 'Placement disabled',
        nextStatus === 'active' ? 'teal' : 'deep'
      );
      notifyActiveAdsUpdated();
      await loadWorkspaceData();
    } catch (err) {
      showToast(
        formatReadableError(err, 'Unable to update placement status.'),
        'terracotta'
      );
    }
  };

  const handleConfirmDeletePlacement = async () => {
    if (!deletePlacementTarget) return;
    setDeleting(true);
    try {
      await deleteVisualPlacement(deletePlacementTarget.id, getIdToken);
      setDeletePlacementTarget(null);
      showToast('Visual placement deleted', 'deep');
      notifyActiveAdsUpdated();
      await loadWorkspaceData();
    } catch (err) {
      showToast(formatReadableError(err, 'Unable to delete placement.'), 'terracotta');
    } finally {
      setDeleting(false);
    }
  };

  const openModalPreview = () => {
    const mockPreview: AdRecord = {
      id: editingAdId || 'preview_draft',
      name: formState.name || 'Draft Advertisement',
      provider: formState.provider || 'Preview Provider',
      adType: formState.adType,
      scriptCode: formState.scriptCode,
      placementId: formState.placementId || 'preview_slot',
      placementName: placementMap.get(formState.placementId)?.name || 'Visual Placement',
      width: formState.width || 'auto',
      height: formState.height || 'auto',
      status: 'active',
      priority: formState.priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPreviewAd(mockPreview);
  };

  return (
    <div className="space-y-8">
      {/* Visual Placement Selection Hero CTA */}
      <section className="rounded-3xl bg-[#264653] text-[#FAF7F2] p-6 sm:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-5 shadow-sm">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#2A9D8F]">
            <Crosshair className="w-4 h-4" aria-hidden="true" />
            <span>Visual Point-and-Select Placement Engine</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
            Select Exact Ad Positions Directly on ImageLab
          </h2>
          <p className="text-xs sm:text-sm text-[#F4EDE4]/78 leading-relaxed">
            Open the live website in Placement Selection Mode, scroll through any public page, and double-tap any section or area to lock its exact location for ads.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => startVisualSelection('/')}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold shadow-sm transition-colors min-h-[46px] whitespace-nowrap"
          >
            <Crosshair className="w-4 h-4" aria-hidden="true" />
            <span>Select Placement on Website</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            disabled={placements.length === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] disabled:opacity-50 text-white text-sm font-semibold transition-colors min-h-[46px] whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add New Advertisement</span>
          </button>
        </div>
      </section>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-4 flex items-start gap-2.5 text-xs font-medium text-[#264653]"
        >
          <AlertCircle className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      {/* SECTION 1: Saved Visual Placements */}
      <section className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden">
        <div className="p-5 border-b border-[#264653]/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#264653] flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#2A9D8F]" aria-hidden="true" />
              <span>Saved Visual Placements ({placements.length})</span>
            </h3>
            <p className="text-xs text-[#264653]/65 mt-0.5">
              Each placement represents a double-tapped target area on the website.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startVisualSelection('/')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E76F51]/12 hover:bg-[#E76F51] text-[#D05A3C] hover:text-white text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Visual Area</span>
          </button>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((n) => (
              <div key={n} className="h-14 rounded-xl bg-[#F4EDE4]/70 animate-pulse" />
            ))}
          </div>
        ) : placements.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm font-semibold text-[#264653]">
              No visual placements selected yet
            </p>
            <p className="text-xs text-[#264653]/65 max-w-md mx-auto">
              Click <strong>&ldquo;Select Placement on Website&rdquo;</strong> above to browse the live ImageLab site and double-tap any area where you want an ad to appear.
            </p>
            <button
              type="button"
              onClick={() => startVisualSelection('/')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold"
            >
              <Crosshair className="w-4 h-4" />
              <span>Select Placement on Website</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#264653]/10">
            {placements.map((plc) => {
              const linkedAdsCount = ads.filter((a) => a.placementId === plc.id).length;
              return (
                <div
                  key={plc.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#F4EDE4]/35 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[#264653]">{plc.name}</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          plc.status === 'active' ? 'text-[#2A9D8F]' : 'text-[#D05A3C]'
                        }`}
                      >
                        · {plc.status === 'active' ? 'Active' : 'Disabled'}
                      </span>
                      <span className="text-[11px] font-mono text-[#264653]/55">
                        · Priority #{plc.priority}
                      </span>
                      <span className="text-[11px] font-mono text-[#264653]/60">
                        · {linkedAdsCount} {linkedAdsCount === 1 ? 'ad' : 'ads'}
                      </span>
                    </div>

                    <p className="text-xs text-[#264653]/70 truncate">
                      Route: <span className="font-mono font-semibold">{plc.pageRoute}</span> ·
                      Position: <strong className="uppercase">{plc.position}</strong> · Format:{' '}
                      <span>{getAdTypeLabel(plc.adType || 'responsive_banner')}</span> (
                      <span className="font-mono">
                        {plc.width || 'auto'} × {plc.height || 'auto'}
                      </span>
                      ) · Area: <span>{plc.elementInfo}</span>
                    </p>

                    {plc.anchorMissing && (
                      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D05A3C]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Anchor element not found on current page layout — re-select area on website.
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const targetRoute = plc.pageRoute.includes('*')
                          ? '/'
                          : plc.pageRoute;
                        startVisualSelection(targetRoute);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-xs font-semibold"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Preview Placement</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingAdId(null);
                        setFormState({
                          ...DEFAULT_AD_FORM,
                          placementId: plc.id,
                          adType: plc.adType || DEFAULT_AD_FORM.adType,
                          width: plc.width || DEFAULT_AD_FORM.width,
                          height: plc.height || DEFAULT_AD_FORM.height,
                        });
                        setFormError(null);
                        setModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2A9D8F]/12 text-[#218175] hover:bg-[#2A9D8F] hover:text-white text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Assign Ad</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTogglePlacementStatus(plc)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                        plc.status === 'active'
                          ? 'bg-[#E76F51]/12 text-[#D05A3C] hover:bg-[#E76F51] hover:text-white'
                          : 'bg-[#2A9D8F]/12 text-[#218175] hover:bg-[#2A9D8F] hover:text-white'
                      }`}
                    >
                      {plc.status === 'active' ? 'Disable' : 'Enable'}
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditPlacement(plc)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#264653]/8 hover:bg-[#264653] hover:text-white text-[#264653] text-xs font-semibold"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit / Rename</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletePlacementTarget(plc)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#E76F51]/10 hover:bg-[#D05A3C] hover:text-white text-[#D05A3C] text-xs font-semibold"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 2: Advertisements Bound to Visual Placements */}
      <section className="space-y-4">
        <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#E76F51]">
              <Megaphone className="w-4 h-4" aria-hidden="true" />
              <span>Advertisements Inventory</span>
            </div>
            <h3 className="text-lg font-bold text-[#264653]">
              Active &amp; Scheduled Ads ({ads.length} total ·{' '}
              <span className="font-mono tabular-nums text-[#2A9D8F]">
                {ads.filter((a) => a.status === 'active').length} active
              </span>
              )
            </h3>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add New Advertisement</span>
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search
              className="w-4 h-4 text-[#264653]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search ad name, provider, placement..."
              aria-label="Search advertisements"
              className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
            />
          </div>

          <select
            value={placementFilter}
            onChange={(e) => setPlacementFilter(e.target.value)}
            aria-label="Filter by saved placement"
            className="h-11 px-3.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
          >
            <option value="all">All Visual Placements</option>
            {placements.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.pageRoute})
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | AdStatus)}
            aria-label="Filter by status"
            className="h-11 px-3.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="disabled">Disabled Only</option>
          </select>
        </div>

        <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-14 rounded-xl bg-[#F4EDE4]/70 animate-pulse" />
              ))}
            </div>
          ) : filteredAds.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-[#264653]">
                No advertisements matched your filters
              </p>
              <p className="text-xs text-[#264653]/65 max-w-md mx-auto">
                {placements.length === 0
                  ? 'First select a placement area directly on the website, then create an ad for that slot.'
                  : 'Create an advertisement and assign it to any of your saved visual placements.'}
              </p>
              {placements.length === 0 ? (
                <button
                  type="button"
                  onClick={() => startVisualSelection('/')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#E76F51] text-white text-xs font-semibold"
                >
                  <Crosshair className="w-4 h-4" />
                  <span>Select Placement on Website</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#2A9D8F] text-white text-xs font-semibold"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Advertisement</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#264653]/12 text-[11px] font-bold uppercase tracking-wider text-[#264653]/60 bg-[#F4EDE4]/45">
                      <th className="py-3.5 px-4">Ad Name</th>
                      <th className="py-3.5 px-4">Provider</th>
                      <th className="py-3.5 px-4">Selected Placement & Priority</th>
                      <th className="py-3.5 px-4">Format</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4">Last Updated</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#264653]/10 text-xs">
                    {filteredAds.map((ad) => {
                      const draft = rowDrafts[ad.id] || {
                        placementId: ad.placementId,
                        priority: ad.priority,
                      };
                      const isDirty =
                        draft.placementId !== ad.placementId ||
                        draft.priority !== ad.priority;
                      const placementMissing = !placementMap.has(ad.placementId);

                      return (
                        <tr key={ad.id} className="hover:bg-[#F4EDE4]/35 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-[#264653] max-w-[180px] truncate">
                            {ad.name}
                          </td>
                          <td className="py-3.5 px-4 text-[#264653]/80">{ad.provider}</td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <select
                                value={draft.placementId}
                                onChange={(e) =>
                                  setRowDrafts((prev) => ({
                                    ...prev,
                                    [ad.id]: {
                                      ...draft,
                                      placementId: e.target.value,
                                    },
                                  }))
                                }
                                aria-label={`Change placement for ${ad.name}`}
                                className="h-8 px-2 rounded-lg bg-[#F4EDE4]/70 border border-[#264653]/15 text-xs text-[#264653] max-w-[220px]"
                              >
                                {placementMissing && (
                                  <option value={ad.placementId}>
                                    [Removed Placement] {ad.placementName || ad.placementId}
                                  </option>
                                )}
                                {placements.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.pageRoute})
                                  </option>
                                ))}
                              </select>

                              <input
                                type="number"
                                min={1}
                                max={999}
                                value={draft.priority}
                                onChange={(e) =>
                                  setRowDrafts((prev) => ({
                                    ...prev,
                                    [ad.id]: {
                                      ...draft,
                                      priority: Math.max(
                                        1,
                                        Math.min(999, Number(e.target.value) || 1)
                                      ),
                                    },
                                  }))
                                }
                                aria-label={`Priority for ${ad.name}`}
                                className="w-16 h-8 px-2 rounded-lg bg-[#F4EDE4]/70 border border-[#264653]/15 font-mono text-xs tabular-nums text-[#264653]"
                              />

                              {isDirty && (
                                <button
                                  type="button"
                                  disabled={savingRowId === ad.id}
                                  onClick={() => handleSaveRowQuickChanges(ad)}
                                  className="px-2.5 h-8 rounded-lg bg-[#2A9D8F] hover:bg-[#218175] text-white text-[11px] font-semibold whitespace-nowrap"
                                >
                                  {savingRowId === ad.id ? 'Saving...' : 'Save'}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-[#264653]/75">
                            <span>{getAdTypeLabel(ad.adType)}</span>
                            <span className="block font-mono text-[10px] text-[#264653]/55 tabular-nums">
                              {ad.width} × {ad.height}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`font-semibold ${
                                ad.status === 'active' ? 'text-[#2A9D8F]' : 'text-[#D05A3C]'
                              }`}
                            >
                              {ad.status === 'active' ? 'Enabled' : 'Disabled'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[11px] tabular-nums text-[#264653]/65">
                            {formatTimestamp(ad.updatedAt)}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPreviewAd(ad)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] font-semibold"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Preview</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleAdStatus(ad)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold ${
                                  ad.status === 'active'
                                    ? 'bg-[#E76F51]/12 text-[#D05A3C] hover:bg-[#E76F51] hover:text-white'
                                    : 'bg-[#2A9D8F]/12 text-[#218175] hover:bg-[#2A9D8F] hover:text-white'
                                }`}
                              >
                                {ad.status === 'active' ? (
                                  <>
                                    <PauseCircle className="w-3.5 h-3.5" />
                                    <span>Disable</span>
                                  </>
                                ) : (
                                  <>
                                    <PlayCircle className="w-3.5 h-3.5" />
                                    <span>Enable</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => openEditModal(ad)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#264653]/8 hover:bg-[#264653] hover:text-white text-[#264653] font-semibold"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setDeleteTarget(ad)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#E76F51]/10 hover:bg-[#D05A3C] hover:text-white text-[#D05A3C] font-semibold"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="lg:hidden divide-y divide-[#264653]/10">
                {filteredAds.map((ad) => {
                  const draft = rowDrafts[ad.id] || {
                    placementId: ad.placementId,
                    priority: ad.priority,
                  };
                  const isDirty =
                    draft.placementId !== ad.placementId || draft.priority !== ad.priority;
                  const placementMissing = !placementMap.has(ad.placementId);

                  return (
                    <div key={ad.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-[#264653] truncate">{ad.name}</h4>
                          <p className="text-xs text-[#264653]/70">
                            {ad.provider} · {getAdTypeLabel(ad.adType)} ·{' '}
                            <span className="font-mono tabular-nums">
                              {ad.width} × {ad.height}
                            </span>
                          </p>
                        </div>
                        <span
                          className={`text-xs font-semibold shrink-0 ${
                            ad.status === 'active' ? 'text-[#2A9D8F]' : 'text-[#D05A3C]'
                          }`}
                        >
                          {ad.status === 'active' ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select
                          value={draft.placementId}
                          onChange={(e) =>
                            setRowDrafts((prev) => ({
                              ...prev,
                              [ad.id]: { ...draft, placementId: e.target.value },
                            }))
                          }
                          className="h-10 px-3 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 text-xs text-[#264653]"
                        >
                          {placementMissing && (
                            <option value={ad.placementId}>
                              [Removed] {ad.placementName || ad.placementId}
                            </option>
                          )}
                          {placements.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.pageRoute})
                            </option>
                          ))}
                        </select>

                        <div className="flex items-center gap-2">
                          <label className="text-xs text-[#264653]/70 shrink-0">Priority</label>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={draft.priority}
                            onChange={(e) =>
                              setRowDrafts((prev) => ({
                                ...prev,
                                [ad.id]: {
                                  ...draft,
                                  priority: Math.max(1, Math.min(999, Number(e.target.value) || 1)),
                                },
                              }))
                            }
                            className="flex-1 h-10 px-3 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 font-mono text-xs tabular-nums"
                          />
                          {isDirty && (
                            <button
                              type="button"
                              disabled={savingRowId === ad.id}
                              onClick={() => handleSaveRowQuickChanges(ad)}
                              className="px-3 h-10 rounded-xl bg-[#2A9D8F] text-white text-xs font-semibold shrink-0"
                            >
                              Save
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setPreviewAd(ad)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-[#F4EDE4] text-[#264653] text-xs font-semibold min-h-[40px]"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Preview</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleAdStatus(ad)}
                          className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold min-h-[40px] ${
                            ad.status === 'active'
                              ? 'bg-[#E76F51]/12 text-[#D05A3C]'
                              : 'bg-[#2A9D8F]/12 text-[#218175]'
                          }`}
                        >
                          <span>{ad.status === 'active' ? 'Disable' : 'Enable'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(ad)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-[#264653]/10 text-[#264653] text-xs font-semibold min-h-[40px]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(ad)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-[#E76F51]/12 text-[#D05A3C] text-xs font-semibold min-h-[40px]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Create / Edit Advertisement Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ad-modal-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-8 my-8 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="ad-modal-title" className="text-xl font-bold text-[#264653]">
                {editingAdId ? 'Edit Advertisement' : 'Add New Advertisement'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4] min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-3.5 flex items-start gap-2 text-xs font-medium text-[#264653]"
              >
                <AlertCircle className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveAd} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    Advertisement Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.name}
                    onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Homepage Leaderboard"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm text-[#264653]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    Ad Provider *
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.provider}
                    onChange={(e) => setFormState((p) => ({ ...p, provider: e.target.value }))}
                    placeholder="e.g., Google AdSense, Adsterra, Custom"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm text-[#264653]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    Ad Type *
                  </label>
                  <select
                    value={formState.adType}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, adType: e.target.value as AdType }))
                    }
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm text-[#264653]"
                  >
                    {AD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-[#264653]">
                      Selected Website Placement *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setModalOpen(false);
                        startVisualSelection('/');
                      }}
                      className="text-[11px] font-semibold text-[#E76F51] hover:underline"
                    >
                      + Pick New Area
                    </button>
                  </div>
                  <select
                    required
                    value={formState.placementId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      const matched = placementMap.get(nextId);
                      setFormState((p) => {
                        if (!editingAdId && matched) {
                          return {
                            ...p,
                            placementId: nextId,
                            adType: matched.adType || p.adType,
                            width: matched.width || p.width,
                            height: matched.height || p.height,
                          };
                        }
                        return { ...p, placementId: nextId };
                      });
                    }}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm text-[#264653]"
                  >
                    <option value="">Choose a visually selected area...</option>
                    {placements.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.pageRoute} ({p.position} · {p.width || 'auto'}×{p.height || 'auto'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">Width</label>
                  <input
                    type="text"
                    value={formState.width}
                    onChange={(e) => setFormState((p) => ({ ...p, width: e.target.value }))}
                    placeholder="auto or 728px"
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-mono text-xs text-[#264653]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">Height</label>
                  <input
                    type="text"
                    value={formState.height}
                    onChange={(e) => setFormState((p) => ({ ...p, height: e.target.value }))}
                    placeholder="auto or 90px"
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-mono text-xs text-[#264653]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">Status</label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, status: e.target.value as AdStatus }))
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-xs font-semibold text-[#264653]"
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">Priority</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={formState.priority}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, priority: Number(e.target.value) || 10 }))
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-mono text-xs tabular-nums text-[#264653]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-[#264653]">
                    Advertisement Script Code *
                  </label>
                  <span className="text-[11px] text-[#264653]/60">
                    Executed inside isolated sandboxed container
                  </span>
                </div>
                <textarea
                  rows={6}
                  required
                  value={formState.scriptCode}
                  onChange={(e) => setFormState((p) => ({ ...p, scriptCode: e.target.value }))}
                  placeholder="<script async src='...'></script>&#10;<!-- Or AdSense <ins>, Native HTML, or Custom Banner HTML/JS -->"
                  className="w-full p-3.5 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 font-mono text-xs leading-relaxed text-[#264653]"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#264653]/10">
                <button
                  type="button"
                  disabled={formState.scriptCode.trim().length < 5}
                  onClick={openModalPreview}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] disabled:opacity-50 text-xs font-semibold text-[#264653] min-h-[42px]"
                >
                  <Eye className="w-4 h-4" />
                  <span>Preview Advertisement</span>
                </button>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4] min-h-[42px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold transition-colors min-h-[42px]"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {saving
                        ? 'Saving...'
                        : editingAdId
                          ? 'Save Advertisement'
                          : 'Save Advertisement'}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Saved Visual Placement Modal */}
      {editingPlacement && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-placement-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="edit-placement-title" className="text-lg font-bold text-[#264653]">
                  Edit Visual Placement
                </h2>
                <p className="text-xs text-[#264653]/65 font-mono">
                  {editingPlacement.pageRoute} · {editingPlacement.slotId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPlacement(null)}
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlacementEdit} className="space-y-4">
              {placementEditError && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-3 flex items-start gap-2 text-xs font-medium text-[#264653]"
                >
                  <AlertCircle className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5" />
                  <span>{placementEditError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1">
                  Placement Name *
                </label>
                <input
                  type="text"
                  required
                  value={placementEditForm.name}
                  onChange={(e) =>
                    setPlacementEditForm((p) => ({ ...p, name: e.target.value }))
                  }
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">Position</label>
                  <select
                    value={placementEditForm.position}
                    onChange={(e) =>
                      setPlacementEditForm((p) => ({
                        ...p,
                        position: e.target.value as AdInsertPosition,
                      }))
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-xs font-semibold"
                  >
                    <option value="before">Before</option>
                    <option value="after">After</option>
                    <option value="inside">Inside</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">Status</label>
                  <select
                    value={placementEditForm.status}
                    onChange={(e) =>
                      setPlacementEditForm((p) => ({
                        ...p,
                        status: e.target.value as AdStatus,
                      }))
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-xs font-semibold"
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">Priority</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={placementEditForm.priority}
                    onChange={(e) =>
                      setPlacementEditForm((p) => ({
                        ...p,
                        priority: Math.max(1, Math.min(999, Number(e.target.value) || 10)),
                      }))
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">Ad Type</label>
                  <select
                    value={placementEditForm.adType}
                    onChange={(e) =>
                      setPlacementEditForm((p) => ({
                        ...p,
                        adType: e.target.value as AdType,
                      }))
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-xs font-semibold"
                  >
                    {AD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">
                    Dimension Preset
                  </label>
                  <select
                    value={
                      DIMENSION_PRESETS.find(
                        (d) =>
                          d.width === placementEditForm.width &&
                          d.height === placementEditForm.height
                      )?.key || 'custom'
                    }
                    onChange={(e) => {
                      const preset = DIMENSION_PRESETS.find((d) => d.key === e.target.value);
                      if (preset) {
                        setPlacementEditForm((p) => ({
                          ...p,
                          width: preset.width,
                          height: preset.height,
                        }));
                      }
                    }}
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-xs font-semibold"
                  >
                    {DIMENSION_PRESETS.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                    <option value="custom">Custom Dimensions</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">Width</label>
                  <input
                    type="text"
                    value={placementEditForm.width}
                    onChange={(e) =>
                      setPlacementEditForm((p) => ({ ...p, width: e.target.value }))
                    }
                    placeholder="auto or 728px"
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">Height</label>
                  <input
                    type="text"
                    value={placementEditForm.height}
                    onChange={(e) =>
                      setPlacementEditForm((p) => ({ ...p, height: e.target.value }))
                    }
                    placeholder="auto or 90px"
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#264653]/10">
                <button
                  type="button"
                  onClick={() => setEditingPlacement(null)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPlacementEdit}
                  className="px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold"
                >
                  {savingPlacementEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Advertisement Modal (Test Mode) */}
      {previewAd && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ad-preview-title"
          className="fixed inset-0 z-[60] bg-[#264653]/65 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-3xl rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-8 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#2A9D8F]">
                  Test Mode Active · Impressions Not Counted
                </p>
                <h3 id="ad-preview-title" className="text-lg font-bold text-[#264653]">
                  Preview: {previewAd.name}
                </h3>
                <p className="text-xs text-[#264653]/70">
                  Placement:{' '}
                  <strong>
                    {placementMap.get(previewAd.placementId)?.name ||
                      previewAd.placementName ||
                      previewAd.placementId}
                  </strong>{' '}
                  · Format: {getAdTypeLabel(previewAd.adType)} · Size: {previewAd.width} ×{' '}
                  {previewAd.height}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAd(null)}
                aria-label="Close preview"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4] min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-[#F4EDE4] border border-dashed border-[#264653]/25">
              <AdSlot
                placementId={previewAd.placementId}
                placementName={placementMap.get(previewAd.placementId)?.name}
                testMode
                adOverride={previewAd}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewAd(null)}
                className="px-5 py-2.5 rounded-xl bg-[#264653] text-white text-xs font-semibold"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Advertisement Confirmation */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] bg-[#264653]/65 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#264653]">Delete Advertisement</h3>
            <p className="text-sm text-[#264653]/80 leading-relaxed">
              Permanently remove <strong>{deleteTarget.name}</strong> from ImageLab?
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDeleteAd}
                className="px-5 py-2.5 rounded-xl bg-[#D05A3C] hover:bg-[#b5482c] text-white text-sm font-semibold"
              >
                {deleting ? 'Deleting...' : 'Delete Advertisement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Visual Placement Confirmation */}
      {deletePlacementTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] bg-[#264653]/65 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#264653]">Delete Visual Placement</h3>
            <p className="text-sm text-[#264653]/80 leading-relaxed">
              Are you sure you want to remove placement{' '}
              <strong>{deletePlacementTarget.name}</strong>? Any ads linked to it will stop displaying until reassigned.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletePlacementTarget(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDeletePlacement}
                className="px-5 py-2.5 rounded-xl bg-[#D05A3C] hover:bg-[#b5482c] text-white text-sm font-semibold"
              >
                {deleting ? 'Deleting...' : 'Delete Placement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
