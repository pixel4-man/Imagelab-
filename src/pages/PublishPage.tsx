import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Lock,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SafeImage } from '../components/SafeImage';
import { SeoHead } from '../components/SeoHead';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { resolvePersistableArtworkUrl } from '../lib/imageUpload';

interface FormErrors {
  image?: string;
  title?: string;
  promptText?: string;
}

function detectAspectRatio(width: number, height: number): '16:9' | '4:3' | '3:4' | '1:1' {
  if (!width || !height) return '4:3';
  const ratio = width / height;
  if (ratio >= 1.55) return '16:9';
  if (ratio >= 1.12) return '4:3';
  if (ratio <= 0.88) return '3:4';
  return '1:1';
}

export function PublishPage() {
  const { publishPrompt, refreshPublicPrompts } = useApp();
  const { firebaseUser, userProfile, authReady } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [imageFileName, setImageFileName] = useState<string>('');
  const [detectedAspectRatio, setDetectedAspectRatio] = useState<'16:9' | '4:3' | '3:4' | '1:1'>('4:3');
  const [title, setTitle] = useState('');
  const [promptText, setPromptText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [publishing, setPublishing] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type.toLowerCase())) {
      setErrors((prev) => ({
        ...prev,
        image: 'Please select a valid image file (PNG, JPG, JPEG, or WebP).',
      }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        image: 'Image file size must be under 10 MB.',
      }));
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        setImagePreview(dataUrl);
        setImageFileName(file.name);
        setErrors((prev) => ({ ...prev, image: undefined }));

        // Silently infer aspect ratio for balanced gallery framing
        const probe = new Image();
        probe.onload = () => {
          setDetectedAspectRatio(detectAspectRatio(probe.naturalWidth, probe.naturalHeight));
        };
        probe.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};

    if (!imagePreview) {
      nextErrors.image = 'An AI-generated image upload is required.';
    }
    if (!title.trim()) {
      nextErrors.title = 'Please enter a title for your image.';
    } else if (title.trim().length < 3) {
      nextErrors.title = 'Title must be at least 3 characters.';
    }
    if (!promptText.trim()) {
      nextErrors.promptText = 'The AI generation prompt is required.';
    } else if (promptText.trim().length < 10) {
      nextErrors.promptText = 'Please enter at least 10 characters for the AI prompt.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !firebaseUser || !userProfile) return;

    setPublishing(true);
    let resolvedImage = imagePreview;

    if (db) {
      try {
        resolvedImage = await resolvePersistableArtworkUrl({
          file: imageFile,
          previewDataUrl: imagePreview,
          uid: firebaseUser.uid,
          folder: 'prompts',
        });
      } catch {
        // Keep data URL fallback
      }
    }

    const cleanTitle = title.trim().slice(0, 120);
    const cleanPrompt = promptText.trim().slice(0, 4000);

    const created = publishPrompt({
      title: cleanTitle,
      promptText: cleanPrompt,
      imageUrl: resolvedImage,
      aspectRatio: detectedAspectRatio,
      authorUid: firebaseUser.uid,
      authorType: 'contributor',
      status: 'approved',
    });

    if (db) {
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'prompts', created.id), {
          id: created.id,
          title: cleanTitle,
          promptText: cleanPrompt,
          imageUrl: resolvedImage,
          aspectRatio: detectedAspectRatio,
          authorUid: firebaseUser.uid,
          authorUsername: userProfile.username,
          authorType: 'contributor',
          status: 'approved',
          likes: 0,
          copies: 0,
          views: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'promptSecrets', created.id), {
          id: created.id,
          promptText: cleanPrompt,
          authorUid: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        await refreshPublicPrompts();
      } catch (err) {
        setPublishing(false);
        handleFirestoreError(err, OperationType.CREATE, `prompts/${created.id}`);
        return;
      }
    }

    setPublishing(false);
    setPublishedId(created.id);
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview('');
    setImageFileName('');
    setDetectedAspectRatio('4:3');
    setTitle('');
    setPromptText('');
    setErrors({});
    setPublishedId(null);
  };

  if (!authReady) {
    return (
      <PageTransition>
        <SeoHead
          title="Publish a Prompt — ImageLab"
          description="Share an AI creation and prompt on ImageLab."
          canonicalPath="/publish"
          noindex
        />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/10 p-10 animate-pulse space-y-4">
            <div className="h-4 w-36 bg-[#E8DEC8] rounded" />
            <div className="h-8 w-72 bg-[#E8DEC8] rounded" />
            <div className="h-24 w-full bg-[#E8DEC8]/70 rounded-2xl" />
          </div>
        </div>
      </PageTransition>
    );
  }

  if (!firebaseUser) {
    return (
      <PageTransition>
        <SeoHead
          title="Publish a Prompt — ImageLab"
          description="Sign in to publish an AI creation on ImageLab."
          canonicalPath="/publish"
          noindex
        />
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-20 space-y-6">
          <BackButton fallbackTo="/" label="Back" />
          <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-8 sm:p-10 text-center space-y-5 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-[#F4EDE4] text-[#264653] flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6" aria-hidden="true" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#264653]">
              Sign in to share your creations
            </h1>
            <p className="text-sm text-[#264653]/75 leading-relaxed max-w-md mx-auto">
              Browse creations freely, sign in to copy full prompts, or create a free ImageLab contributor account to share your own AI creations.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link
                to="/login?redirect=%2Fpublish"
                className="px-6 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
              >
                Login
              </Link>
              <Link
                to="/signup?redirect=%2Fpublish"
                className="px-6 py-3 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-sm font-semibold transition-colors"
              >
                Create Account
              </Link>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <SeoHead
        title="Publish a Prompt — ImageLab"
        description="Upload AI artwork and attach your generation prompt on ImageLab."
        canonicalPath="/publish"
        noindex
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-5">
          <BackButton fallbackTo="/" label="Back" />
        </div>
        <div className="max-w-3xl mb-8">
          <p className="text-xs font-semibold text-[#E76F51] mb-2">
            Share Your Creations
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#264653] mb-3">
            Publish an AI Artwork & Prompt
          </h1>
          <p className="text-base text-[#264653]/75 leading-relaxed">
            Upload your image, give it a clear title, and paste the exact prompt that produced it.
          </p>
        </div>

        {publishedId ? (
          <div className="rounded-3xl bg-[#FAF7F2] border border-[#2A9D8F]/35 p-8 sm:p-12 max-w-2xl mx-auto text-center space-y-5 shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-[#2A9D8F]/14 text-[#2A9D8F] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-[#264653]">
              Prompt Published Successfully
            </h2>
            <p className="text-sm text-[#264653]/75 leading-relaxed">
              Your artwork <strong>{title}</strong> has been published under{' '}
              <strong>@{userProfile?.username}</strong> and is now live across ImageLab.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate(`/prompt/${publishedId}`)}
                className="px-5 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
              >
                View Prompt Details
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-5 py-3 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-sm font-semibold transition-colors"
              >
                Publish Another Prompt
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
            {/* Simplified 3-Field Publishing Form */}
            <form
              onSubmit={handleSubmit}
              noValidate
              className="lg:col-span-7 rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-6 sm:p-8 space-y-6 shadow-sm"
            >
              {/* 1. Upload Image */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-[#264653]">
                    1. Upload Image <span className="text-[#E76F51]">*</span>
                  </label>
                  {imagePreview && (
                    <button
                      type="button"
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview('');
                        setImageFileName('');
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#E76F51] hover:underline"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  aria-label="Upload AI-generated image"
                  className={`relative rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-[#2A9D8F] bg-[#2A9D8F]/8'
                      : errors.image
                        ? 'border-[#E76F51] bg-[#E76F51]/5'
                        : 'border-[#264653]/20 bg-[#F4EDE4]/55 hover:border-[#2A9D8F]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                    className="sr-only"
                  />

                  {imagePreview ? (
                    <div className="space-y-3">
                      <div className="max-h-64 rounded-xl overflow-hidden bg-[#E8DEC8] mx-auto inline-block">
                        <img
                          src={imagePreview}
                          alt="Uploaded preview"
                          className="max-h-64 w-auto object-contain mx-auto"
                        />
                      </div>
                      <p className="text-xs font-medium text-[#2A9D8F]">
                        Selected: {imageFileName || 'Uploaded Artwork'} — Click to replace
                      </p>
                    </div>
                  ) : (
                    <div className="py-5 space-y-2.5">
                      <div className="w-12 h-12 rounded-xl bg-[#FAF7F2] border border-[#264653]/12 flex items-center justify-center mx-auto text-[#264653]">
                        <Upload className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-semibold text-[#264653]">
                        Drop your AI artwork here, or browse files
                      </p>
                      <p className="text-xs text-[#264653]/60">
                        Supports JPG, JPEG, PNG, and WebP up to 10 MB
                      </p>
                    </div>
                  )}
                </div>

                {errors.image && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#D05A3C]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{errors.image}</span>
                  </p>
                )}
              </div>

              {/* 2. Image Title */}
              <div>
                <label
                  htmlFor="publish-title"
                  className="block text-sm font-bold text-[#264653] mb-2"
                >
                  2. Image Title <span className="text-[#E76F51]">*</span>
                </label>
                <input
                  id="publish-title"
                  type="text"
                  maxLength={120}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                  }}
                  placeholder="e.g., Sunlit Travertine Courtyard at Dusk"
                  className={`w-full h-11 px-4 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] placeholder:text-[#264653]/45 focus:outline-none focus:ring-2 ${
                    errors.title
                      ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                      : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                  }`}
                />
                {errors.title && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#D05A3C]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{errors.title}</span>
                  </p>
                )}
              </div>

              {/* 3. AI Generation Prompt */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="publish-prompt"
                    className="text-sm font-bold text-[#264653]"
                  >
                    3. AI Generation Prompt <span className="text-[#E76F51]">*</span>
                  </label>
                  <span className="text-xs font-sans font-medium tabular-nums text-[#264653]/55">
                    {promptText.length} / 4000
                  </span>
                </div>
                <textarea
                  id="publish-prompt"
                  rows={6}
                  maxLength={4000}
                  value={promptText}
                  onChange={(e) => {
                    setPromptText(e.target.value);
                    if (errors.promptText)
                      setErrors((prev) => ({ ...prev, promptText: undefined }));
                  }}
                  placeholder="Paste the exact prompt used to generate this image..."
                  className={`w-full px-4 py-3 rounded-xl bg-[#F4EDE4]/55 border font-sans font-normal text-sm text-[#264653] placeholder:text-[#264653]/45 focus:outline-none focus:ring-2 leading-relaxed ${
                    errors.promptText
                      ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                      : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                  }`}
                />
                {errors.promptText && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#D05A3C]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{errors.promptText}</span>
                  </p>
                )}
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-[#264653]/10">
                <p className="text-xs text-[#264653]/60">
                  Publishing as <strong>@{userProfile?.username || 'contributor'}</strong>
                </p>

                <button
                  type="submit"
                  disabled={publishing}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold shadow-sm transition-colors min-h-[46px]"
                >
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  <span>{publishing ? 'Publishing...' : 'Publish Prompt'}</span>
                </button>
              </div>
            </form>

            {/* Live Gallery Card Preview */}
            <aside className="lg:col-span-5 lg:sticky lg:top-24 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#264653]">
                  Live Gallery Card Preview
                </h2>
                <span className="text-xs text-[#264653]/60">Updates as you type</span>
              </div>

              <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden shadow-sm">
                <div className="aspect-[4/3] bg-[#E8DEC8]/50 flex items-center justify-center overflow-hidden">
                  {imagePreview ? (
                    <SafeImage
                      src={imagePreview}
                      alt={title || 'Live preview'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-6 text-[#264653]/45 space-y-2">
                      <ImagePlus className="w-8 h-8 mx-auto" aria-hidden="true" />
                      <p className="text-xs font-medium">
                        Your uploaded artwork preview will appear here
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-5 space-y-2">
                  <h3 className="text-lg font-bold text-[#264653] truncate">
                    {title.trim() || 'Untitled Creation'}
                  </h3>

                  <p className="text-xs font-medium text-[#2A9D8F]">
                    @{userProfile?.username || 'contributor'}
                  </p>
                  {promptText.trim() && (
                    <p className="text-xs font-sans font-normal text-[#264653]/75 leading-relaxed pt-1 line-clamp-3">
                      {promptText.trim()}
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
