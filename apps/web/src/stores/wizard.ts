import { create } from 'zustand';

/**
 * Where the booking wizard is open and which fields the AI just changed.
 * The draft itself lives on the server (mock or api) and is read through TanStack Query.
 * `conversationId` records which conversation the open draft belongs to, so switching chats
 * closes a panel that no longer matches and the booking result goes back to the right place.
 */
type WizardState = {
  openDraftId: string | null;
  host: 'chat' | 'dashboard' | null;
  conversationId: string | null;
  /** Field ids to flash as "changed by AI"; cleared after the animation. */
  highlighted: string[];
  /** Field ids that failed validation on the last "Next" press. */
  invalid: string[];
  /** Set right after a successful submit so the wizard can show its done state. */
  completedBookingId: string | null;
  open: (draftId: string, host: 'chat' | 'dashboard', conversationId?: string | null) => void;
  close: () => void;
  highlight: (fields: string[]) => void;
  clearHighlight: () => void;
  unhighlight: (field: string) => void;
  setInvalid: (fields: string[]) => void;
  setCompleted: (bookingId: string | null) => void;
};

export const useWizard = create<WizardState>((set) => ({
  openDraftId: null,
  host: null,
  conversationId: null,
  highlighted: [],
  invalid: [],
  completedBookingId: null,
  open: (draftId, host, conversationId = null) =>
    set({ openDraftId: draftId, host, conversationId, invalid: [], completedBookingId: null }),
  close: () =>
    set({
      openDraftId: null,
      host: null,
      conversationId: null,
      highlighted: [],
      invalid: [],
      completedBookingId: null,
    }),
  highlight: (fields) => set({ highlighted: fields }),
  clearHighlight: () => set({ highlighted: [] }),
  unhighlight: (field) =>
    set((state) => ({ highlighted: state.highlighted.filter((id) => id !== field) })),
  setInvalid: (fields) => set({ invalid: fields }),
  setCompleted: (bookingId) => set({ completedBookingId: bookingId }),
}));
