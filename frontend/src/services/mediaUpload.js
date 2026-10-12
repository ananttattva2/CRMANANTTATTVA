import api from './api';

export async function uploadMedia(file, folder = 'crm/uploads') {
  if (!file) throw new Error('Please select a file.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const checksum = btoa(String.fromCharCode(...digest));
  const { data: authorization } = await api.post('/assets/upload-url', {
    name: file.name, type: file.type || 'application/octet-stream', size: file.size, folder, checksum
  });
  const response = await fetch(authorization.uploadUrl, {
    method: 'PUT', headers: authorization.headers, body: file
  });
  if (!response.ok) throw new Error('Spaces upload failed. Please retry.');
  const { data: verified } = await api.post('/assets/upload-confirm', { token: authorization.token });
  return verified;
}

export async function uploadMediaBatch(files, folder = 'crm/uploads') {
  return Promise.all(Array.from(files || []).map((file) => uploadMedia(file, folder)));
}

export function mediaUrl(value) {
  return value?.secureUrl || value?.url || value?.dataUrl || (typeof value === 'string' ? value : '');
}
