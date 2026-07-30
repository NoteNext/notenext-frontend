// Central backend API configuration.
//
// The browser talks to the backend directly (no server-side proxy), so this
// value must be reachable from the client. Override it per-environment with
// the NEXT_PUBLIC_API_BASE_URL build-time env var.
//
// NOTE: because calls are cross-origin now, the backend must send CORS headers
// (Access-Control-Allow-Origin for the frontend origin, plus the methods and
// headers used below) or the browser will block the requests.
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api-notenext.suvojeetsengupta.in'
).replace(/\/$/, '');

// LocalStorage helpers for the note delete-token and edit-token (creator proof).
const deleteTokenKey = (shareId: string) => `nn_delete_token_${shareId}`;
const editTokenKey = (shareId: string) => `nn_edit_token_${shareId}`;

export function saveEditToken(shareId: string, token: string) {
  if (typeof window === 'undefined' || !token) return;
  localStorage.setItem(editTokenKey(shareId), token);
  const created = JSON.parse(localStorage.getItem('nn_created_notes') || '[]');
  if (!created.includes(shareId)) {
    created.push(shareId);
    localStorage.setItem('nn_created_notes', JSON.stringify(created));
  }
}

export function saveDeleteToken(shareId: string, token: string) {
  if (typeof window === 'undefined' || !token) return;
  localStorage.setItem(deleteTokenKey(shareId), token);
  const created = JSON.parse(localStorage.getItem('nn_created_notes') || '[]');
  if (!created.includes(shareId)) {
    created.push(shareId);
    localStorage.setItem('nn_created_notes', JSON.stringify(created));
  }
}

export function getEditToken(shareId: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(editTokenKey(shareId)) || localStorage.getItem(deleteTokenKey(shareId));
}

export function getDeleteToken(shareId: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(deleteTokenKey(shareId)) || localStorage.getItem(editTokenKey(shareId));
}

export function clearEditToken(shareId: string) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(editTokenKey(shareId));
}

export function clearDeleteToken(shareId: string) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(deleteTokenKey(shareId));
  localStorage.removeItem(editTokenKey(shareId));
  const created = JSON.parse(localStorage.getItem('nn_created_notes') || '[]');
  localStorage.setItem(
    'nn_created_notes',
    JSON.stringify(created.filter((id: string) => id !== shareId))
  );
}

export function isCreator(shareId: string): boolean {
  if (typeof window === 'undefined') return false;
  if (localStorage.getItem(editTokenKey(shareId)) || localStorage.getItem(deleteTokenKey(shareId))) return true;
  const created = JSON.parse(localStorage.getItem('nn_created_notes') || '[]');
  return created.includes(shareId);
}

// Fetch a note directly from the backend.
export async function fetchNote(shareId: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/notes/${shareId}`);
}

// Update a note directly in the backend using the stored or provided edit token.
export async function updateNote(
  shareId: string,
  payload: { ciphertext?: string; iv?: string; content?: string; editToken?: string }
): Promise<Response> {
  const token = payload.editToken || getEditToken(shareId) || getDeleteToken(shareId) || '';
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Edit token required. Only the creator of this note can edit it.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body: Record<string, any> = {
    editToken: token,
    deleteToken: token,
  };
  if (payload.ciphertext !== undefined) body.ciphertext = payload.ciphertext;
  if (payload.iv !== undefined) body.iv = payload.iv;
  if (payload.content !== undefined) body.content = payload.content;

  return fetch(`${API_BASE_URL}/api/notes/${shareId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-edit-token': token,
      'x-delete-token': token,
    },
    body: JSON.stringify(body),
  });
}

// Delete a note directly from the backend using the stored delete token.
export async function deleteNote(shareId: string, customToken?: string): Promise<Response> {
  const token = customToken || getDeleteToken(shareId) || getEditToken(shareId) || '';
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Only the creator of this note can delete it.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return fetch(
    `${API_BASE_URL}/api/notes/${shareId}?token=${encodeURIComponent(token)}&deleteToken=${encodeURIComponent(token)}&editToken=${encodeURIComponent(token)}`,
    {
      method: 'DELETE',
      headers: {
        'x-delete-token': token,
        'x-edit-token': token,
        'X-Delete-Token': token,
        'X-Edit-Token': token,
        'Delete-Token': token,
        accept: '*/*',
      },
    }
  );
}
