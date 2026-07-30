'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Save, Check, Loader2, Copy, ExternalLink, RefreshCw, Lock } from 'lucide-react';
import { generateKey, exportKey, encryptData } from '@/lib/crypto';
import { API_BASE_URL, saveDeleteToken, saveEditToken } from '@/lib/api';

// Language options matching Katbin clone requirements
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

// Backend accepts a duration string clamped to [1 minute, 30 days] and defaults
// to 1 day (see /docs). Values below use the API's duration format; anything
// longer than 30 days is not supported, so there is no "Never" option.
const EXPIRATIONS = [
  { value: '10m', label: '10 Minutes' },
  { value: '1h', label: '1 Hour' },
  { value: '6h', label: '6 Hours' },
  { value: '1d', label: '1 Day' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days (Max)' },
];

export const runtime = 'edge';

export default function CreatePastePage() {
  const router = useRouter();
  
  // Paste inputs
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [sharedBy, setSharedBy] = useState('');
  const [language, setLanguage] = useState('text');
  const [expiration, setExpiration] = useState('1d');
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [maxReads, setMaxReads] = useState('');
  const [encryptNote, setEncryptNote] = useState(true); // Toggle between AES-GCM and rawData (base64)

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' } | null>(null);
  const [shortenedUrl, setShortenedUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Automatically focus the textarea on load
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  // Keyboard shortcut Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, title, sharedBy, language, expiration, burnAfterRead, maxReads, encryptNote, isSaving]);

  // Show temporary toast messages
  const showToast = (message: string, type: 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  // Check if content is a URL for auto-shortening message
  const isUrl = (text: string) => {
    try {
      const url = new URL(text.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // Safe UTF-8 Base64 Encoder
  const utf8ToBase64 = (str: string) => {
    try {
      return btoa(
        encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
          return String.fromCharCode(parseInt(p1, 16));
        })
      );
    } catch (e) {
      return btoa(str); // Fallback
    }
  };

  const handleSave = async () => {
    if (!content.trim()) {
      showToast('Paste content cannot be empty!', 'error');
      return;
    }

    if (isSaving) return;

    setIsSaving(true);
    try {
      let ciphertext = '';
      let iv = 'aB3dE5fG7hI9jK1L'; // Default dummy IV
      let keyHex = '';

      if (encryptNote) {
        // 1. Generate client-side AES key
        const key = await generateKey();
        
        // 2. Prepare payload to encrypt (Title + Language + Content)
        const dataToEncrypt = JSON.stringify({
          content: content,
          title: title.trim() || 'Untitled Note',
          language: language,
        });

        // 3. Encrypt data client-side
        const encrypted = await encryptData(dataToEncrypt, key);
        ciphertext = encrypted.ciphertext;
        iv = encrypted.iv;
        
        // Export AES key to base64url representation for shorter URL hash
        keyHex = await exportKey(key);
      } else {
        // 4. rawData: true Mode (Base64 only, no encryption)
        ciphertext = utf8ToBase64(content);
      }

      // 5. Send package directly to the backend API
      const response = await fetch(`${API_BASE_URL}/api/notes/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ciphertext,
          iv,
          sharedBy: sharedBy.trim() || 'Anonymous',
          expiresIn: expiration,
          burnAfterRead,
          maxReads: maxReads.trim() ? parseInt(maxReads, 10) : null,
          rawData: !encryptNote,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned code ${response.status}`);
      }

      const note = await response.json();

      // Store the edit and delete tokens locally so the creator can edit or delete the note later.
      if (note.editToken) {
        saveEditToken(note.shareId, note.editToken);
      }
      if (note.deleteToken) {
        saveDeleteToken(note.shareId, note.deleteToken);
      }

      showToast('Note shared and link copied!');
      
      // 6. Redirect to view page or display shortened URL
      const redirectUrl = encryptNote ? `/${note.shareId}#${keyHex}` : `/${note.shareId}`;
      const absoluteUrl = `${window.location.origin}${redirectUrl}`;

      navigator.clipboard.writeText(absoluteUrl).catch(console.error);

      if (isUrl(content)) {
        // URL Shortener Mode: Show URL modal on home page
        setShortenedUrl(absoluteUrl);
        setIsSaving(false);
      } else {
        // Normal Paste Mode: Redirect to view page
        router.push(redirectUrl);
      }
    } catch (error: any) {
      console.error('Transmission or encryption error:', error);
      showToast(error.message || 'Failed to share note.', 'error');
      setIsSaving(false);
    }
  };

  const handleCopyShortened = () => {
    if (shortenedUrl) {
      navigator.clipboard.writeText(shortenedUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      showToast('Shortened link copied!');
    }
  };

  const handleCreateAnother = () => {
    setShortenedUrl(null);
    setContent('');
    setTitle('');
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full w-full bg-[#212121] overflow-hidden select-none">
      {/* Header */}
      <header className="flex w-full justify-between items-center py-3 px-6 bg-[#1a1a1a] border-b border-zinc-800">
        <a href="/" className="flex items-center gap-2.5 hover:opacity-90">
          <img src="/icon.svg" alt="NoteNext Logo" className="h-7 w-7 rounded-sm" />
          <span className="font-bold text-xl tracking-tight">
            <span className="text-[#ff9800]">&lt;Note</span>Next/&gt;
          </span>
        </a>

        <div className="flex items-center gap-4">
          {/* Settings Toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-sm transition-colors cursor-pointer ${
              showSettings ? 'text-[#ff9800] bg-zinc-800' : 'text-white hover:text-[#ff9800] hover:bg-zinc-800/50'
            }`}
            title="Note Settings"
          >
            <Settings className="h-5 w-5" />
          </button>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="p-1.5 text-white hover:text-[#ff9800] hover:bg-zinc-800/50 rounded-sm transition-colors disabled:opacity-50 cursor-pointer"
            title="Save and Share (Ctrl+S)"
          >
            {isSaving ? (
              <Loader2 className="h-5 w-5 animate-spin text-[#ff9800]" />
            ) : (
              <Save className="h-5 w-5" />
            )}
          </button>
        </div>
      </header>

      {/* Settings Dropdown/Panel */}
      {showSettings && (
        <div className="w-full bg-[#1a1a1a] border-b border-zinc-800 px-6 py-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs font-bold text-white transition-all duration-200">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#ff9800]">TITLE</label>
            <input
              type="text"
              value={title}
              disabled={!encryptNote}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={encryptNote ? "Untitled Note" : "Disabled in Raw Mode"}
              className={`border rounded px-2.5 py-1.5 outline-none text-white ${
                encryptNote 
                  ? 'bg-[#212121] border-zinc-800 focus:border-[#ff9800]' 
                  : 'bg-zinc-900 border-zinc-800 opacity-50 cursor-not-allowed'
              }`}
            />
          </div>

          {/* Shared By */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#ff9800]">SHARED BY (AUTHOR)</label>
            <input
              type="text"
              value={sharedBy}
              onChange={(e) => setSharedBy(e.target.value)}
              placeholder="Anonymous"
              className="bg-[#212121] border border-zinc-800 rounded px-2.5 py-1.5 text-white outline-none focus:border-[#ff9800]"
            />
          </div>

          {/* Language selection for syntax highlighting */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#ff9800]">SYNTAX HIGHLIGHTING</label>
            <select
              value={language}
              disabled={!encryptNote}
              onChange={(e) => setLanguage(e.target.value)}
              className={`border rounded px-2.5 py-1.5 text-white outline-none focus:border-[#ff9800] appearance-none ${
                encryptNote 
                  ? 'bg-[#212121] border-zinc-800' 
                  : 'bg-zinc-900 border-zinc-800 opacity-50 cursor-not-allowed'
              }`}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value} className="bg-[#212121]">
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* Expiration */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#ff9800]">EXPIRATION (TTL)</label>
            <select
              value={expiration}
              onChange={(e) => setExpiration(e.target.value)}
              className="bg-[#212121] border border-zinc-800 rounded px-2.5 py-1.5 text-white outline-none focus:border-[#ff9800]"
            >
              {EXPIRATIONS.map((e) => (
                <option key={e.value} value={e.value} className="bg-[#212121]">
                  {e.label}
                </option>
              ))}
            </select>
          </div>

          {/* Max Reads */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#ff9800]">MAX READS (VEWS LIMIT)</label>
            <input
              type="number"
              min="1"
              value={maxReads}
              onChange={(e) => setMaxReads(e.target.value)}
              placeholder="Unlimited"
              className="bg-[#212121] border border-zinc-800 rounded px-2.5 py-1.5 text-white outline-none focus:border-[#ff9800]"
            />
          </div>

          {/* Toggles Group */}
          <div className="flex flex-col gap-3 mt-4">
            {/* Burn After Read */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="burnAfterRead"
                checked={burnAfterRead}
                onChange={(e) => setBurnAfterRead(e.target.checked)}
                className="w-4 h-4 rounded accent-[#ff9800] bg-[#212121] border-zinc-800 cursor-pointer"
              />
              <label htmlFor="burnAfterRead" className="text-white cursor-pointer select-none">
                BURN AFTER READING (DELETES ON FIRST VISIT)
              </label>
            </div>

            {/* Encrypt Toggle */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="encryptToggle"
                checked={encryptNote}
                onChange={(e) => setEncryptNote(e.target.checked)}
                className="w-4 h-4 rounded accent-[#ff9800] bg-[#212121] border-zinc-800 cursor-pointer"
              />
              <label htmlFor="encryptToggle" className="text-white cursor-pointer select-none">
                CLIENT-SIDE ENCRYPTION (AES-GCM)
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 w-full h-full relative overflow-hidden bg-[#212121]">
        {/* Dynamic status notice */}
        <p className="flex items-center px-6 py-3 text-[#ff9800] bg-[#1a1a1a] select-none text-xs border-b border-zinc-800/20">
          <span className="text-[#ff9800] mr-2">&gt;</span>
          {content && isUrl(content) && encryptNote ? (
            <span className="text-white">URL detected! NoteNext will encrypt and shorten it automatically.</span>
          ) : !encryptNote ? (
            <span className="text-zinc-400">Raw Base64 mode active. Content is shared without client-side encryption.</span>
          ) : (
            <span className="text-zinc-400 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> End to end encrypted sharing</span>
          )}
        </p>

        {/* Text Area Input */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type or paste your content here..."
          className="w-full h-[calc(100%-40px)] px-6 py-6 outline-none bg-[#212121] text-white font-bold resize-none border-0 text-sm overflow-y-auto selection:bg-[#ff9800]/30"
        />

        {/* Shortened URL Overlay Modal */}
        {shortenedUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#212121]/95 z-40 p-6 select-text">
            <div className="max-w-md w-full p-8 bg-[#1a1a1a] border border-zinc-800 rounded text-center">
              <div className="w-12 h-12 bg-green-500/10 border border-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="h-6 w-6 text-green-500 animate-pulse" />
              </div>
              <h2 className="text-[#ff9800] font-bold text-base mb-2">URL SHORTENED SUCCESSFULLY</h2>
              <p className="text-zinc-500 text-xs font-bold mb-6">
                Your direct redirection link is ready:
              </p>

              {/* Link Input Box */}
              <div className="flex bg-[#212121] border border-zinc-800 rounded mb-6 overflow-hidden">
                <input
                  type="text"
                  readOnly
                  value={shortenedUrl}
                  className="flex-1 px-4 py-2 bg-transparent text-white font-mono text-xs select-all outline-none border-0 font-bold"
                />
                <button
                  onClick={handleCopyShortened}
                  className="px-4 bg-zinc-800 text-[#ff9800] hover:text-white border-l border-zinc-800 cursor-pointer flex items-center justify-center"
                  title="Copy link"
                >
                  {copiedLink ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                <a
                  href={shortenedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors"
                >
                  TEST REDIRECT LINK
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={handleCreateAnother}
                  className="text-xs text-zinc-500 hover:text-white underline transition-colors cursor-pointer"
                >
                  Create another paste/link
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="font-bold border-t border-zinc-800 bg-[#1a1a1a] z-10">
        <div className="flex px-6 py-2.5 text-xs justify-between text-[#ff9800]">
          <a href="/" className="hover:underline">
            © 2026 NoteNext
          </a>
        </div>
      </footer>

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
