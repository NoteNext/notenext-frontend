'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';
import { deleteNote, clearNoteToken } from '@/lib/api';

interface DeletePageProps {
  params: Promise<{ shareId: string }>;
}

export const runtime = 'edge';

export default function DeletePastePage(props: DeletePageProps) {
  const router = useRouter();
  const { shareId } = use(props.params);

  const [deleting, setDeleting] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const performDelete = async () => {
      try {
        setDeleting(true);
        setError(null);

        // Perform delete directly against the backend using the stored token
        const res = await deleteNote(shareId);

        if (!res.ok) {
          throw new Error('Failed to delete note. You might not be the creator of this note or it may have already been deleted.');
        }

        // Clean up from local storage
        clearNoteToken(shareId);

        setSuccess(true);
        // Redirect back home after 3 seconds
        setTimeout(() => {
          router.push('/');
        }, 3000);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to delete note.');
      } finally {
        setDeleting(false);
      }
    };

    performDelete();
  }, [shareId, router]);

  return (
    <div className="flex flex-col flex-1 h-full w-full bg-[#212121] items-center justify-center text-white select-none p-6">
      <div className="max-w-md w-full p-8 bg-[#1a1a1a] border border-zinc-800 rounded text-center">
        {deleting && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-red-500 mx-auto mb-4" />
            <h2 className="text-red-500 font-bold text-sm">ATTEMPTING TO DELETE NOTE...</h2>
            <p className="text-zinc-400 text-xs mt-2 font-bold">Communicating with server...</p>
          </>
        )}
        
        {success && (
          <>
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-4" />
            <h2 className="text-green-500 font-bold text-sm mb-2">NOTE DELETED SUCCESSFULLY</h2>
            <p className="text-zinc-400 text-xs leading-5 mb-4 font-bold">
              The note has been deleted from the database. Redirecting you home...
            </p>
            <a
              href="/"
              className="inline-block px-6 py-2 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors"
            >
              Back to Home
            </a>
          </>
        )}

        {error && (
          <>
            <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-4" />
            <h2 className="text-red-500 font-bold text-sm mb-2">DELETION FAILED</h2>
            <p className="text-zinc-400 text-xs leading-5 mb-6 font-bold">{error}</p>
            <div className="flex flex-col gap-3">
              <a
                href="/"
                className="px-6 py-2.5 bg-[#ff9800] text-black font-bold text-xs rounded hover:bg-amber-600 transition-colors"
              >
                CREATE NEW PASTE
              </a>
              <button
                onClick={() => router.back()}
                className="text-xs text-zinc-500 hover:text-white underline transition-colors cursor-pointer"
              >
                Go back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
