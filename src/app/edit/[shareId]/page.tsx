'use client';

import React, { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Save, Key, AlertTriangle, ArrowLeft } from 'lucide-react';
import { importKey, decryptData, encryptData } from '@/lib/crypto';
import { mapLanguage } from '@/lib/syntax';
import { 
  fetchNote, updateNote, isCreator as checkIsCreator, 
  getEditToken, saveEditToken 
} from '@/lib/api';

const LANGUAGES = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'text', label: 'Plain Text' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
];

interface EditPageProps {
  params: Promise<{ shareId: string }>;
}

export const runtime = 'edge';

export default function EditPastePage(props: EditPageProps) {
  const router = useRouter();
  const { shareId } = use(props.params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rawNote, setRawNote] = useState<any>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('Untitled Note');
  const [editLanguage, setEditLanguage] = useState('text');
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' } | null>(null);

  const [promptForToken, setPromptForToken] = useState(false);
  const [editTokenInput, setEditTokenInput] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const base64ToUtf8 = (base64: string) => {
    try {
      return decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    } catch (e) {
      return atob(base64);
    }
  };

  const utf8ToBase64 = (str: string) => {
    try {
      return btoa(
        encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
          return String.fromCharCode(parseInt(p1, 16));
        })
      );
    } catch (e) {
      return btoa(str);
    }
  };

  const showToast = (message: string, type: 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  useEffect(() => {
    const loadNoteForEditing = async () => {
      try {
        setLoading(true);
        setError(null);

        const hash = window.location.hash;
        const hexKey = hash && hash.length > 1 ? hash.substring(1) : null;

        const storedToken = getEditToken(shareId);
        if (!storedToken && !checkIsCreator(shareId)) {
          setPromptForToken(true);
        }

        const res = await fetchNote(shareId);
        if (res.status === 404) {
          throw new Error('This note does not exist or has expired.');
        }
        if (!res.ok) {
          throw new Error(`Failed to fetch note (HTTP ${res.status})`);
        }

        const note = await res.json();
        setRawNote(note);

        let contentStr = '';
        let titleStr = 'Untitled Note';
        let langStr = 'text';

        if (note.content && !note.ciphertext) {
          contentStr = note.content;
        } else if (hexKey) {
          const cryptoKey = await importKey(hexKey);
          contentStr = await decryptData(note.ciphertext, note.iv, cryptoKey);
          try {
            const parsed = JSON.parse(contentStr);
            contentStr = parsed.content;
            titleStr = parsed.title || 'Untitled Note';
            langStr = parsed.language || 'text';
          } catch {
            // fallback
          }
        } else {
          contentStr = base64ToUtf8(note.ciphertext);
          try {
            const parsed = JSON.parse(contentStr);
            if (parsed && typeof parsed === 'object' && 'content' in parsed) {
              contentStr = parsed.content;
              titleStr = parsed.title || 'Untitled Note';
              langStr = parsed.language || 'text';
            }
          } catch {
            // fallback
          }
        }

        setEditContent(contentStr);
        setEditTitle(titleStr);
        setEditLanguage(langStr);
        setLoading(false);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to load note for editing.');
        setLoading(false);
      }
    };

    loadNoteForEditing();
  }, [shareId]);

  const handleConfirmToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTokenInput.trim()) return;
    saveEditToken(shareId, editTokenInput.trim());
    setPromptForToken(false);
  };

  const handleSave = async () => {
    if (!editContent.trim()) {
      showToast('Note content cannot be empty!', 'error');
      return;
    }

    const token = getEditToken(shareId) || editTokenInput.trim();
    if (!token) {
      setPromptForToken(true);
      return;
    }

    if (isSaving) return;
    setIsSaving(true);

    try {
      const hash = window.location.hash;
      const hexKey = hash && hash.length > 1 ? hash.substring(1) : null;

      let payload: { ciphertext?: string; iv?: string; content?: string; editToken?: string } = {
        editToken: token,
      };

      if (hexKey && rawNote?.ciphertext) {
        const cryptoKey = await importKey(hexKey);
        const dataToEncrypt = JSON.stringify({
          content: editContent,
          title: editTitle.trim() || 'Untitled Note',
          language: editLanguage,
        });
        const encrypted = await encryptData(dataToEncrypt, cryptoKey);
        payload.ciphertext = encrypted.ciphertext;
        payload.iv = encrypted.iv;
      } else if (rawNote?.content && !rawNote?.ciphertext) {
        payload.content = editContent;
      } else {
        const dataStr = JSON.stringify({
          content: editContent,
          title: editTitle.trim() || 'Untitled Note',
          language: editLanguage,
        });
        payload.ciphertext = utf8ToBase64(dataStr);
        payload.iv = rawNote?.iv || 'aB3dE5fG7hI9jK1L';
        payload.content = editContent;
      }

      const res = await updateNote(shareId, payload);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to update note (HTTP ${res.status})`);
      }

      saveEditToken(shareId, token);
      showToast('Note updated successfully!');
      setTimeout(() => {
        router.push(`/${shareId}${window.location.hash}`);
      }, 800);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to update note.', 'error');
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editContent, editTitle, editLanguage, editTokenInput, isSaving]);

  if (loading) {
    return (
      <div className="flex flex-col flex-1 h-full w-full bg-[#212121] items-center justify-center text-white select-none">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff9800] mb-4" />
        <p className="font-bold text-sm">LOADING NOTE FOR EDITING...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1 h-full w-full bg-[#212121] items-center justify-center text-white select-none p-6">
        <div className="max-w-md p-6 bg-[#1a1a1a] border border-zinc-800 rounded text-center">
          <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-4" />
          <h2 className="text-red-500 font-bold text-base mb-2">CANNOT EDIT NOTE</h2>
          <p className="text-zinc-400 text-xs font-bold leading-5 mb-6">{error}</p>
          <a
            href="/"
            className="inline-block px-6 py-2 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors"
          >
            CREATE NEW PASTE
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full w-full bg-[#212121] overflow-hidden select-none">
      {/* Header */}
      <header className="flex w-full justify-between items-center py-3 px-6 bg-[#1a1a1a] border-b border-zinc-800">
        <a href="/" className="hover:opacity-90">
          <span className="font-bold text-xl tracking-tight">
            <span className="text-[#ff9800]">&lt;Note</span>Next/&gt;
          </span>
        </a>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors cursor-pointer disabled:opacity-50"
            title="Save Changes (Ctrl+S)"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin text-black" /> : <Save className="h-4 w-4" />}
            SAVE CHANGES
          </button>
          <button
            onClick={() => router.push(`/${shareId}${window.location.hash}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-white font-bold text-xs rounded hover:bg-zinc-700 transition-colors cursor-pointer"
            title="Back to Note"
          >
            <ArrowLeft className="h-4 w-4" />
            BACK
          </button>
        </div>
      </header>

      {/* Settings bar */}
      <div className="bg-[#1a1a1a] border-b border-zinc-800 px-6 py-3 flex flex-wrap items-center gap-4 text-xs font-bold">
        <div className="flex items-center gap-2">
          <label className="text-[#ff9800]">TITLE:</label>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Untitled Note"
            className="bg-[#212121] border border-zinc-800 rounded px-2.5 py-1 text-white outline-none focus:border-[#ff9800]"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[#ff9800]">LANGUAGE:</label>
          <select
            value={editLanguage}
            onChange={(e) => setEditLanguage(e.target.value)}
            className="bg-[#212121] border border-zinc-800 rounded px-2.5 py-1 text-white outline-none focus:border-[#ff9800] appearance-none cursor-pointer"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value} className="bg-[#212121]">
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Workspace Textarea */}
      <main className="flex-1 w-full h-full relative bg-[#212121] select-text">
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          placeholder="Edit your note content..."
          className="w-full h-full p-6 bg-[#212121] text-white font-mono font-bold text-sm outline-none resize-none border-0 selection:bg-[#ff9800]/30"
        />
      </main>

      {/* Token Modal */}
      {promptForToken && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6 select-text">
          <div className="max-w-md w-full p-8 bg-[#1a1a1a] border border-zinc-800 rounded">
            <div className="w-12 h-12 bg-[#ff9800]/10 border border-[#ff9800] rounded-full flex items-center justify-center mx-auto mb-4">
              <Pencil className="h-5 w-5 text-[#ff9800]" />
            </div>
            <h2 className="text-[#ff9800] font-bold text-base text-center mb-2">EDIT TOKEN REQUIRED</h2>
            <p className="text-zinc-400 text-xs font-bold text-center leading-5 mb-6">
              Please enter the edit token issued when creating this note.
            </p>

            <form onSubmit={handleConfirmToken} className="space-y-4">
              <div className="flex bg-[#212121] border border-zinc-800 rounded overflow-hidden p-1 items-center">
                <Key className="h-4 w-4 text-zinc-500 ml-3 mr-2 flex-shrink-0" />
                <input
                  type="password"
                  placeholder="Enter Edit Token"
                  value={editTokenInput}
                  onChange={(e) => setEditTokenInput(e.target.value)}
                  className="flex-1 px-2 py-2 bg-transparent text-white font-mono text-xs outline-none border-0 font-bold"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors cursor-pointer"
              >
                PROCEED TO EDIT
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-12 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded shadow-lg text-xs font-bold text-center border toast-enter ${
            toast.type === 'error'
              ? 'bg-[#1a1a1a] border-[#ff9800] text-[#ff9800]'
              : 'bg-[#ff9800] border-[#ff9800] text-black'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
