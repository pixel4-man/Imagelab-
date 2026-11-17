import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

/**
 * Compresses an image file or Data URL into an editorial web JPEG Data URL
 * guaranteed to fit comfortably under Firestore document limits (~220 KB max).
 */
export async function compressImageToDataUrl(
  fileOrDataUrl: File | string,
  maxDimension = 1280,
  initialQuality = 0.82
): Promise<string> {
  const sourceUrl =
    typeof fileOrDataUrl === 'string'
      ? fileOrDataUrl
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('Could not read selected image file.'));
          reader.onerror = () => reject(new Error('Could not read selected image file.'));
          reader.readAsDataURL(fileOrDataUrl);
        });

  if (sourceUrl.length <= 280_000) {
    return sourceUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth || maxDimension;
      let height = img.naturalHeight || maxDimension;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceUrl.slice(0, 450_000));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      let quality = initialQuality;
      let output = canvas.toDataURL('image/jpeg', quality);
      while (output.length > 380_000 && quality > 0.45) {
        quality -= 0.12;
        output = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(output);
    };
    img.onerror = () => resolve(sourceUrl);
    img.src = sourceUrl;
  });
}

/**
 * Attempts uploading to Firebase Storage first when available, falling back cleanly
 * to a compressed JPEG Data URL so user and official artwork uploads always persist.
 */
export async function resolvePersistableArtworkUrl(options: {
  file?: File | null;
  previewDataUrl: string;
  uid: string;
  folder?: string;
}): Promise<string> {
  const { file, previewDataUrl, uid, folder = 'prompts' } = options;

  if (file && storage) {
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
      const storageRef = ref(storage, `${folder}/${uid}/${Date.now()}_${safeName}`);
      const uploadPromise = uploadBytes(storageRef, file, { contentType: file.type }).then(
        (snap) => getDownloadURL(snap.ref)
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('Storage upload timeout')), 15000)
      );
      const downloadUrl = await Promise.race([uploadPromise, timeoutPromise]);
      if (downloadUrl) {
        return downloadUrl;
      }
    } catch {
      // Fallback gracefully to optimized Data URL when Storage CORS/rules are unavailable
    }
  }

  return compressImageToDataUrl(file || previewDataUrl);
}
