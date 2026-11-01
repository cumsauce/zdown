// A phone photo is 4–8 MB and much larger than any blog column. Scale big
// bitmaps down before they become a permanent part of the git history. GIFs
// (animation) and SVGs (vectors) go up untouched; anything the browser can't
// decode here goes up as it is, too.
const MAX_SIDE = 2400;

export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
  const name = file.name || `image.${file.type.split('/')[1] || 'png'}`;
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 400_000) return { blob: file, name };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const png = file.type === 'image/png';
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.85));
    if (!blob || (blob.size >= file.size && scale === 1)) return { blob: file, name };
    return { blob, name: png ? name : name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch {
    return { blob: file, name };
  }
}
