'use client';

import { api } from './api/client';
import type { MediaView } from './api/types';

export const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];
export const MAX_BYTES = 5 * 1024 * 1024;

// Uploads one image the presigned way:
//   1. ask our API for a one-time upload URL
//   2. PUT the file straight to object storage (not through our API),
//      reporting progress as it goes
//   3. tell our API it's done, so the worker can resize it
export async function uploadImage(
  file: File,
  onProgress: (fraction: number) => void,
) {
  if (!ALLOWED_TYPES.includes(file.type))
    throw new Error('Use a JPEG, PNG, WebP or GIF image');
  if (file.size > MAX_BYTES) throw new Error('Images can be at most 5 MB');

  const start = await api<{
    id: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>('/media/uploads', {
    method: 'POST',
    body: { contentType: file.type, bytes: file.size },
  });

  // XMLHttpRequest instead of fetch: fetch can't report upload progress.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', start.uploadUrl);
    for (const [name, value] of Object.entries(start.headers))
      xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () =>
      reject(new Error('Upload failed: check your connection'));
    xhr.send(file);
  });

  return api<MediaView>(`/media/${start.id}/complete`, { method: 'POST' });
}
