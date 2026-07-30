'use client';

import React, { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  FileText, Copy, Download, Trash2, 
  EyeOff, Loader2, ListOrdered, WrapText, Lock, Key,
  Pencil, Save, X
} from 'lucide-react';
import { importKey, decryptData, encryptData } from '@/lib/crypto';
import { highlightToLines, mapLanguage } from '@/lib/syntax';
import { 
  fetchNote, deleteNote, updateNote, 
  isCreator as checkIsCreator, clearDeleteToken, 
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

interface PageProps {
  params: Promise<{ shareId: string }>;
}

export const runtime = 'edge';

export default function ViewPastePage(props: PageProps) {
  const router = useRouter();
  const { shareId } = use(props.params);

  // States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptForKey, setPromptForKey] = useState(false);
  const [enteredKey, setEnteredKey] = useState('');
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const [metadata, setMetadata] = useState<{
    expiresAt: string | null;
    burnAfterRead: boolean;
    sharedBy: string;
    createdAt: string;
    maxReads: number | null;
  } | null>(null);
  
  const [decryptedData, setDecryptedData] = useState<{
    content: string;
    title: string;
    language: string;
  } | null>(null);

  // Raw note payload cache to decrypt later if key is prompted
  const [rawNote, setRawNote] = useState<any>(null);

  // Custom Display States
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const [fontSize, setFontSize] = useState<12 | 14 | 16 | 18 | 20>(14);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' } | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Editing States
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editLanguage, setEditLanguage] = useState('text');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [promptForEditToken, setPromptForEditToken] = useState(false);
  const [manualEditToken, setManualEditToken] = useState('');
  const [editTokenError, setEditTokenError] = useState<string | null>(null);

  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Safe UTF-8 Base64 Decoder & Encoder
  const base64ToUtf8 = (base64: string) => {
    try {
      return decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    } catch (e) {
      return atob(base64); // Fallback
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

  // Load note on mount
  useEffect(() => {
    const fetchAndDecrypt = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Get the key from the URL hash if present
        const hash = window.location.hash;
        const hexKey = hash && hash.length > 1 ? hash.substring(1) : null;

        // 2. Check if the user is the creator by checking local reference
        if (checkIsCreator(shareId)) {
          setIsCreator(true);
        }

        // 3. Fetch note directly from the backend
        const res = await fetchNote(shareId);
        if (res.status === 404) {
          throw new Error('This note does not exist or has expired.');
        }
        if (!res.ok) {
          throw new Error(`Failed to fetch note (HTTP ${res.status})`);
        }

        const note = await res.json();
        setRawNote(note);

        setMetadata({
          expiresAt: note.expiresAt,
          burnAfterRead: note.burnAfterRead,
          sharedBy: note.sharedBy || 'Anonymous',
          createdAt: note.createdAt || new Date().toISOString(),
          maxReads: note.maxReads,
        });

        // 4. Retrieve content
        if (note.content && !note.ciphertext) {
          // Direct content mode — no decryption or base64 decoding needed
          const contentStr = note.content;

          // Redirect if URL
          const trimmedContent = contentStr.trim();
          if (isUrl(trimmedContent)) {
            window.location.replace(trimmedContent);
            return;
          }

          setDecryptedData({
            content: contentStr,
            title: 'Shared Paste',
            language: 'auto',
          });
          setLoading(false);
        } else if (hexKey) {
          // Encrypted Mode with Key in URL
          await decryptWithKey(note, hexKey);
          setLoading(false);
        } else {
          // No Key in URL - Check if the ciphertext is encrypted binary or raw base64 text
          let contentStr = '';
          let isEncrypted = false;

          try {
            contentStr = base64ToUtf8(note.ciphertext);
            // If the decoded content contains control chars (binary data), it is encrypted
            const isBinary = /[\x00-\x08\x0E-\x1F]/.test(contentStr);
            if (isBinary) {
              isEncrypted = true;
            }
          } catch {
            isEncrypted = true; // Threw error during atob/decode, must be raw encrypted binary
          }

          if (isEncrypted) {
            // Display decryption key request screen
            setPromptForKey(true);
            setLoading(false);
          } else {
            // RawData / Base64 Mode (Plaintext fallback)
            let noteTitle = 'Raw Paste';
            let noteLang = 'auto';

            try {
              const parsed = JSON.parse(contentStr);
              if (parsed && typeof parsed === 'object' && 'content' in parsed) {
                contentStr = parsed.content;
                noteTitle = parsed.title || 'Untitled Note';
                noteLang = parsed.language || 'auto';
              }
            } catch {
              // Plain string
            }

            // Redirect if URL
            const trimmedContent = contentStr.trim();
            if (isUrl(trimmedContent)) {
              window.location.replace(trimmedContent);
              return;
            }

            setDecryptedData({
              content: contentStr,
              title: noteTitle,
              language: noteLang,
            });
            setLoading(false);
          }
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'An error occurred while loading this note.');
        setLoading(false);
      }
    };

    fetchAndDecrypt();
  }, [shareId]);

  // Decryption function
  const decryptWithKey = async (note: any, keyStr: string) => {
    try {
      const cryptoKey = await importKey(keyStr);
      let contentStr = await decryptData(note.ciphertext, note.iv, cryptoKey);
      
      let noteTitle = 'Untitled Note';
      let noteLang = 'auto';

      try {
        const parsed = JSON.parse(contentStr);
        contentStr = parsed.content;
        noteTitle = parsed.title || 'Untitled Note';
        noteLang = parsed.language || 'auto';
      } catch {
        // Plain string fallback
      }

      // Check if URL Redirection
      const trimmedContent = contentStr.trim();
      if (isUrl(trimmedContent)) {
        window.location.replace(trimmedContent);
        return;
      }

      setDecryptedData({
        content: contentStr,
        title: noteTitle,
        language: noteLang,
      });
      setPromptForKey(false);
      setError(null);
    } catch (e) {
      throw new Error('Failed to decrypt note. The key is invalid or incorrect.');
    }
  };

  const handleManualDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredKey.trim()) {
      setDecryptError('Please enter a decryption key.');
      return;
    }

    setDecryptError(null);
    try {
      const cleanKey = enteredKey.trim().replace(/^#/, '');
      await decryptWithKey(rawNote, cleanKey);
      showToast('Note decrypted successfully!');
    } catch (err: any) {
      setDecryptError(err.message || 'Decryption failed. Check your key.');
    }
  };

  const isUrl = (text: string) => {
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const showToast = (message: string, type: 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      showToast('Share link copied to clipboard!');
    }
  };

  const handleDownload = () => {
    if (!decryptedData) return;
    
    const content = decryptedData.content;
    const title = decryptedData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'note';
    
    const extensions: Record<string, string> = {
      'text': 'txt',
      'markdown': 'md',
      'javascript': 'js',
      'typescript': 'ts',
      'python': 'py',
      'cpp': 'cpp',
      'c': 'c',
      'go': 'go',
      'rust': 'rs',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'yaml': 'yaml',
      'sql': 'sql',
      'bash': 'sh',
    };
    const mappedLang = mapLanguage(decryptedData.language);
    const ext = extensions[mappedLang] || 'txt';
    const filename = `${title}.${ext}`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded as ${filename}`);
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this paste? This action cannot be undone.')) {
      return;
    }
    
    setIsDeleting(true);
    try {
      const res = await deleteNote(shareId);

      if (!res.ok) {
        throw new Error('Failed to delete note. You might not be authorized.');
      }

      clearDeleteToken(shareId);

      showToast('Note deleted successfully!');
      setTimeout(() => {
        router.push('/');
      }, 1000);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete note.', 'error');
      setIsDeleting(false);
    }
  };

  // Note Editing Logic
  const handleStartEdit = () => {
    const token = getEditToken(shareId);
    if (!token && !isCreator) {
      setPromptForEditToken(true);
      return;
    }
    setEditContent(decryptedData?.content || '');
    setEditTitle(decryptedData?.title || 'Untitled Note');
    setEditLanguage(decryptedData?.language || 'text');
    setIsEditing(true);
    setTimeout(() => {
      if (editTextareaRef.current) {
        editTextareaRef.current.focus();
      }
    }, 50);
  };

  const handleConfirmEditToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualEditToken.trim()) {
      setEditTokenError('Please enter an edit token.');
      return;
    }
    setEditTokenError(null);
    saveEditToken(shareId, manualEditToken.trim());
    setPromptForEditToken(false);
    setEditContent(decryptedData?.content || '');
    setEditTitle(decryptedData?.title || 'Untitled Note');
    setEditLanguage(decryptedData?.language || 'text');
    setIsEditing(true);
    setTimeout(() => {
      if (editTextareaRef.current) {
        editTextareaRef.current.focus();
      }
    }, 50);
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim()) {
      showToast('Note content cannot be empty!', 'error');
      return;
    }

    const token = getEditToken(shareId) || manualEditToken.trim();
    if (!token) {
      setPromptForEditToken(true);
      return;
    }

    if (isSavingEdit) return;

    setIsSavingEdit(true);
    try {
      const hash = window.location.hash;
      const hexKey = hash && hash.length > 1 ? hash.substring(1) : null;
      const activeKey = hexKey || (enteredKey ? enteredKey.trim().replace(/^#/, '') : null);

      let payload: { ciphertext?: string; iv?: string; content?: string; editToken?: string } = {
        editToken: token,
      };

      if (activeKey && rawNote?.ciphertext) {
        // Encrypted note mode
        const cryptoKey = await importKey(activeKey);
        const dataToEncrypt = JSON.stringify({
          content: editContent,
          title: editTitle.trim() || 'Untitled Note',
          language: editLanguage,
        });
        const encrypted = await encryptData(dataToEncrypt, cryptoKey);
        payload.ciphertext = encrypted.ciphertext;
        payload.iv = encrypted.iv;
      } else if (rawNote?.content && !rawNote?.ciphertext) {
        // Direct plaintext content mode
        payload.content = editContent;
      } else {
        // Raw Base64 mode
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
      setDecryptedData({
        content: editContent,
        title: editTitle.trim() || 'Untitled Note',
        language: editLanguage,
      });

      setIsEditing(false);
      setPromptForEditToken(false);
      showToast('Note updated successfully!');
    } catch (err: any) {
      console.error('Failed to update note:', err);
      showToast(err.message || 'Failed to update note.', 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Keyboard shortcut Ctrl+S to save edits
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditing && (e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveEdit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, editContent, editTitle, editLanguage, manualEditToken, isSavingEdit]);

  const codeLines = decryptedData ? highlightToLines(
    decryptedData.content, 
    mapLanguage(decryptedData.language)
  ) : [];

  if (loading) {
    return (
      <div className="flex flex-col flex-1 h-full w-full bg-[#212121] items-center justify-center text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff9800] mb-4" />
        <p className="font-bold text-sm">DECRYPTING NOTE SECURELY CLIENT-SIDE...</p>
      </div>
    );
  }

  // Decryption Key Prompt Screen
  if (promptForKey) {
    return (
      <div className="flex flex-col flex-1 h-full w-full bg-[#212121] items-center justify-center text-white p-6 select-text">
        <div className="max-w-md w-full p-8 bg-[#1a1a1a] border border-zinc-800 rounded">
          <div className="w-12 h-12 bg-[#ff9800]/10 border border-[#ff9800] rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="h-5 w-5 text-[#ff9800]" />
          </div>
          <h2 className="text-[#ff9800] font-bold text-base text-center mb-2">SECURE NOTE ENCRYPTED</h2>
          <p className="text-zinc-400 text-xs font-bold text-center leading-5 mb-6">
            This note is client-side encrypted, but the decryption key is missing from the link. Please enter the key below to access the contents.
          </p>

          <form onSubmit={handleManualDecrypt} className="space-y-4">
            <div className="flex bg-[#212121] border border-zinc-800 rounded overflow-hidden p-1 items-center">
              <Key className="h-4 w-4 text-zinc-500 ml-3 mr-2 flex-shrink-0" />
              <input
                type="password"
                placeholder="Enter Decryption Key"
                value={enteredKey}
                onChange={(e) => setEnteredKey(e.target.value)}
                className="flex-1 px-2 py-2 bg-transparent text-white font-mono text-xs outline-none border-0 font-bold"
              />
            </div>

            {decryptError && (
              <p className="text-red-500 text-xs font-bold text-center">{decryptError}</p>
            )}

            <button
              type="submit"
              className="w-full py-2.5 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors cursor-pointer"
            >
              DECRYPT NOTE
            </button>
          </form>

          <div className="mt-6 text-center">
            <a
              href="/"
              className="text-xs text-zinc-500 hover:text-white underline transition-colors"
            >
              Back to Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1 h-full w-full bg-[#212121] items-center justify-center text-white select-none">
        <div className="max-w-md p-6 bg-[#1a1a1a] border border-zinc-800 rounded text-center">
          <EyeOff className="h-12 w-12 text-[#ff9800] mx-auto mb-4" />
          <h2 className="text-[#ff9800] font-bold text-lg mb-2">ACCESS FAILED</h2>
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

        {/* View Options Toolbar & Action Buttons */}
        <div className="flex items-center gap-3 md:gap-5">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors cursor-pointer disabled:opacity-50"
                title="Save Changes (Ctrl+S)"
              >
                {isSavingEdit ? (
                  <Loader2 className="h-4 w-4 animate-spin text-black" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                SAVE CHANGES
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-white font-bold text-xs rounded hover:bg-zinc-700 transition-colors cursor-pointer"
                title="Cancel Editing"
              >
                <X className="h-4 w-4" />
                CANCEL
              </button>
            </div>
          ) : (
            <>
              {/* Options: Line numbers, wrapping, font-size */}
              <div className="hidden sm:flex items-center border-r border-zinc-800 pr-4 mr-2 gap-3 text-zinc-400">
                {/* Wrap Toggle */}
                <button
                  onClick={() => setWrapLines(!wrapLines)}
                  className={`p-1 rounded cursor-pointer transition-colors ${wrapLines ? 'text-[#ff9800] bg-zinc-800' : 'hover:text-white'}`}
                  title="Toggle Wrap Lines"
                >
                  <WrapText className="h-4 w-4" />
                </button>

                {/* Line Numbers Toggle */}
                <button
                  onClick={() => setShowLineNumbers(!showLineNumbers)}
                  className={`p-1 rounded cursor-pointer transition-colors ${showLineNumbers ? 'text-[#ff9800] bg-zinc-800' : 'hover:text-white'}`}
                  title="Toggle Line Numbers"
                >
                  <ListOrdered className="h-4 w-4" />
                </button>

                {/* Font Size Select */}
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value) as any)}
                  className="bg-[#212121] border border-zinc-800 text-xs px-2 py-0.5 rounded text-white outline-none"
                  title="Font Size"
                >
                  <option value="12">12px</option>
                  <option value="14">14px</option>
                  <option value="16">16px</option>
                  <option value="18">18px</option>
                  <option value="20">20px</option>
                </select>
              </div>

              {/* Edit Button */}
              <button
                onClick={handleStartEdit}
                className="p-1.5 text-white hover:text-[#ff9800] hover:bg-zinc-800/50 rounded-sm transition-colors cursor-pointer"
                title="Edit Note"
              >
                <Pencil className="h-5 w-5" />
              </button>

              {/* Copy Button */}
              <button
                onClick={handleCopyLink}
                className="p-1.5 text-white hover:text-[#ff9800] hover:bg-zinc-800/50 rounded-sm transition-colors cursor-pointer"
                title="Copy Share Link"
              >
                <Copy className="h-5 w-5" />
              </button>

              {/* Download Button */}
              <button
                onClick={handleDownload}
                className="p-1.5 text-white hover:text-[#ff9800] hover:bg-zinc-800/50 rounded-sm transition-colors cursor-pointer"
                title="Download Paste"
              >
                <Download className="h-5 w-5" />
              </button>

              {/* Raw Button */}
              <a
                href={`/raw/${shareId}${window.location.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-white hover:text-[#ff9800] hover:bg-zinc-800/50 rounded-sm transition-colors cursor-pointer"
                title="View Raw text"
              >
                <FileText className="h-5 w-5" />
              </a>

              {/* Delete Button (Creator only) */}
              {isCreator && (
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="p-1.5 text-red-500 hover:text-red-400 hover:bg-zinc-800/50 rounded-sm transition-colors cursor-pointer"
                  title="Delete Note"
                >
                  {isDeleting ? (
                    <Loader2 className="h-5 w-5 animate-spin text-red-500" />
                  ) : (
                    <Trash2 className="h-5 w-5" />
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Metadata bar */}
      <section className="bg-[#1a1a1a] border-b border-zinc-800 px-6 py-2 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-zinc-400 font-bold select-none">
        <div>
          <span className="text-[#ff9800]">TITLE:</span>{' '}
          <span className="text-white">{isEditing ? editTitle || 'Untitled Note' : decryptedData?.title}</span>
        </div>
        <div>
          <span className="text-[#ff9800]">LANGUAGE:</span>{' '}
          <span className="text-white uppercase">{isEditing ? editLanguage : decryptedData?.language}</span>
        </div>
        <div>
          <span className="text-[#ff9800]">SHARED BY:</span>{' '}
          <span className="text-white">{metadata?.sharedBy}</span>
        </div>
        <div>
          <span className="text-[#ff9800]">CREATED:</span>{' '}
          <span className="text-white">
            {metadata ? new Date(metadata.createdAt).toLocaleString() : ''}
          </span>
        </div>
        {metadata?.burnAfterRead && (
          <div className="text-[#ff9800] animate-pulse">
            🔥 BURN AFTER READING ENABLED
          </div>
        )}
      </section>

      {/* Main Content Area */}
      {isEditing ? (
        <div className="flex flex-col flex-1 w-full h-full bg-[#212121] overflow-hidden select-text">
          {/* Edit Toolbar */}
          <div className="bg-[#1a1a1a] border-b border-zinc-800 px-6 py-3 flex flex-wrap items-center gap-4 text-xs font-bold select-none">
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
            <span className="text-zinc-500 text-xs ml-auto hidden sm:inline">
              Press Ctrl+S to save changes
            </span>
          </div>

          {/* Edit Textarea */}
          <textarea
            ref={editTextareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Edit your note content..."
            className="flex-1 w-full h-full p-6 bg-[#212121] text-white font-mono font-bold text-sm outline-none resize-none border-0 selection:bg-[#ff9800]/30"
          />
        </div>
      ) : (
        <main className="flex-1 w-full h-full relative overflow-auto bg-[#212121] py-4 selection:bg-[#ff9800]/30 select-text">
          {/* Standard Syntax Highlighted Code Viewer */}
          <div 
            className="px-6 font-mono font-bold leading-6 overflow-x-auto"
            style={{ fontSize: `${fontSize}px` }}
          >
            {codeLines.map((line, lineIdx) => (
              <div key={lineIdx} className="flex select-text min-w-max hover:bg-zinc-800/10">
                {/* Line number column */}
                {showLineNumbers && (
                  <span className="text-zinc-600 select-none text-right pr-6 w-12 flex-shrink-0 border-r border-zinc-800 mr-4">
                    {lineIdx + 1}
                  </span>
                )}
                
                {/* Code line content */}
                <span className={`flex-1 ${wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
                  {line.length === 0 ? (
                    // empty line spacer
                    <br />
                  ) : (
                    line.map((token, tokenIdx) => (
                      <span 
                        key={tokenIdx} 
                        className={token.type ? `token ${token.type}` : ''}
                      >
                        {token.content}
                      </span>
                    ))
                  )}
                </span>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* Footer */}
      <footer className="font-bold border-t border-zinc-800 bg-[#1a1a1a] z-10 select-none">
        <div className="flex px-6 py-2.5 text-xs justify-between text-[#ff9800]">
          <a href="/" className="hover:underline">
            © 2026 NoteNext
          </a>
        </div>
      </footer>

      {/* Edit Token Prompt Modal */}
      {promptForEditToken && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6 select-text">
          <div className="max-w-md w-full p-8 bg-[#1a1a1a] border border-zinc-800 rounded">
            <div className="w-12 h-12 bg-[#ff9800]/10 border border-[#ff9800] rounded-full flex items-center justify-center mx-auto mb-4">
              <Pencil className="h-5 w-5 text-[#ff9800]" />
            </div>
            <h2 className="text-[#ff9800] font-bold text-base text-center mb-2">EDIT TOKEN REQUIRED</h2>
            <p className="text-zinc-400 text-xs font-bold text-center leading-5 mb-6">
              Authority is proven with the secret edit token issued at note creation time. Please enter your edit token below.
            </p>

            <form onSubmit={handleConfirmEditToken} className="space-y-4">
              <div className="flex bg-[#212121] border border-zinc-800 rounded overflow-hidden p-1 items-center">
                <Key className="h-4 w-4 text-zinc-500 ml-3 mr-2 flex-shrink-0" />
                <input
                  type="password"
                  placeholder="Enter Edit Token"
                  value={manualEditToken}
                  onChange={(e) => setManualEditToken(e.target.value)}
                  className="flex-1 px-2 py-2 bg-transparent text-white font-mono text-xs outline-none border-0 font-bold"
                />
              </div>

              {editTokenError && (
                <p className="text-red-500 text-xs font-bold text-center">{editTokenError}</p>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors cursor-pointer"
                >
                  PROCEED TO EDIT
                </button>
                <button
                  type="button"
                  onClick={() => setPromptForEditToken(false)}
                  className="px-4 py-2.5 bg-zinc-800 text-white font-bold text-xs rounded hover:bg-zinc-700 transition-colors cursor-pointer"
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sleek Custom Toast Notifications */}
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
