import { create } from 'zustand';

export type Page = 'chat' | 'dashboard' | 'profile';

type NavigationState = {
  page: Page;
  navigate: (page: Page) => void;
  /** Receipt to scroll to / flash after navigating to Profile. */
  focusReceiptId: string | null;
  focusReceipt: (id: string | null) => void;
  /** Booking to open in the Dashboard after navigating there. */
  focusBookingId: string | null;
  focusBooking: (id: string | null) => void;
  /** Whether the history list in the sidebar is expanded. */
  historyOpen: boolean;
  toggleHistory: () => void;
};

export const useNavigation = create<NavigationState>((set) => ({
  page: 'chat',
  navigate: (page) => set({ page }),
  focusReceiptId: null,
  focusReceipt: (id) => set({ focusReceiptId: id }),
  focusBookingId: null,
  focusBooking: (id) => set({ focusBookingId: id }),
  historyOpen: true,
  toggleHistory: () => set((state) => ({ historyOpen: !state.historyOpen })),
}));
