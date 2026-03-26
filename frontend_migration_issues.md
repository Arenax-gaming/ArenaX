# ArenaX Frontend Migration: UI/UX Roadmap

This document outlines the granular tasks for rebuilding and enhancing the ArenaX frontend. All work should be done in the `/frontend` directory using Next.js (App Router), Tailwind CSS, and Shadcn UI.

---

## 1. Core Authentication & User Flow

### [FE-AUTH-01] Responsive Login & Registration
- **Work Directory**: `/frontend`
- **Description**: Rebuild login and registration pages with robust client-side validation and responsive design.
- **Tasks**:
    - [ ] Implement Zod-based form validation for Login/Register.
    - [ ] Integration with `/api/auth/login` and `/api/auth/register`.
    - [ ] Add loading states and error toast notifications.
    - [ ] Implement "Remember Me" and "Forgot Password" UI stubs.

### [FE-AUTH-02] Navigation & User Session
- **Work Directory**: `/frontend`
- **Description**: Create a global Sidebar/Navbar that handles user sessions and protected routes.
- **Tasks**:
    - [ ] Implement a responsive Navbar with User Avatar and Menu.
    - [ ] Add high-level navigation: Home, Tournaments, Wallet, Leaderboard.
    - [ ] Create a `ProtectedLink` component for authenticated-only routes.

---

## 2. Gaming Experience & Brackets

### [FE-GAME-01] Dynamic Tournament Dashboard
- **Work Directory**: `/frontend`
- **Description**: A comprehensive view for browsing and joining tournaments.
- **Tasks**:
    - [ ] Implement filtering/sorting for tournaments (Status, Fee, Game Mode).
    - [ ] Create "Joined" vs "Available" tabs.
    - [ ] Implement "Quick Join" modal with entry fee confirmation.

### [FE-GAME-02] Interactive Bracket Visualization
- **Work Directory**: `/frontend`
- **Description**: Visualize tournament progress using an interactive tree/bracket view.
- **Tasks**:
    - [ ] Support for Single Elimination tree view.
    - [ ] Highlight "Active" matches for the logged-in user.
    - [ ] Add tooltips/modals for match details (Player stats, prize distribution).

### [FE-GAME-03] Real-Time Match Hub
- **Work Directory**: `/frontend`
- **Description**: A dedicated match page with real-time score updates and chat.
- **Tasks**:
    - [ ] Implement WebSocket listeners for match state changes.
    - [ ] Add dual-reporting form for players to submit scores.
    - [ ] Integrate conflict resolution alerts.

---

## 3. Wallet & Blockchain UI

### [FE-WALT-01] Stellar/Soroban Wallet Integration
- **Work Directory**: `/frontend`
- **Description**: Dashboard for managing XLM, USDC, and ArenaX tokens.
- **Tasks**:
    - [ ] Implement "Connect Wallet" (Freighter/Albedo).
    - [ ] Display balance breakdown: Available vs Locked (Escrow).
    - [ ] Create "Deposit" and "Withdraw" modals with transaction history.

### [FE-WALT-02] Transaction Status Feed
- **Work Directory**: `/frontend`
- **Description**: Real-time feedback for on-chain actions.
- **Tasks**:
    - [ ] Implement a "Transaction Pending" toast with explorer links.
    - [ ] Show detailed success/failure states for Soroban contract calls.

---

## 4. Static & Informational Pages

### [FE-INFO-01] landing Page Overhaul (Hero & Features)
- **Work Directory**: `/frontend`
- **Description**: A "Wow" first impression for new users.
- **Tasks**:
    - [ ] Implement a high-performance Hero section with subtle animations.
    - [ ] Add "How it Works" and "Active Tournaments" highlights.
    - [ ] Integrate call-to-action (CTA) for registration.

### [FE-INFO-02] About & Mission Page
- **Work Directory**: `/frontend`
- **Description**: [NEW] Share the vision of ArenaX.
- **Tasks**:
    - [ ] Create `/about` page with project story.
    - [ ] Highlight the decentralization aspect and the use of Stellar/Soroban.
    - [ ] Add team/contributor profiles.

### [FE-INFO-03] Contact & Support Center
- **Work Directory**: `/frontend`
- **Description**: [NEW] Interface for user inquiries.
- **Tasks**:
    - [ ] Implement `/contact` form with category selection (Issue, Partnership, Feedback).
    - [ ] Add FAQ/Support section.
    - [ ] Integrate with backend support notification service (placeholder).

### [FE-INFO-04] Terms of Service & Privacy Policy
- **Work Directory**: `/frontend`
- **Description**: [NEW] Essential legal pages.
- **Tasks**:
    - [ ] Create `/terms` and `/privacy` dynamic pages.
    - [ ] Ensure consistent styling and typography.

---

## 5. User Profile & Social

### [FE-PROF-01] Enhanced Profile & Stats
- **Work Directory**: `/frontend`
- **Description**: Detailed user stats, match history, and Elo tracking.
- **Tasks**:
    - [ ] Implement Elo progress charts (Recharts).
    - [ ] Add match history list with result indicators (Win/Loss).
    - [ ] Integrate social links and bio editor.

---

## 6. Real-Time Notifications

### [FE-PUSH-01] Global Notification Center
- **Work Directory**: `/frontend`
- **Description**: Real-time app-wide notifications (e.g., "New Match Found").
- **Tasks**:
    - [ ] Implement a dropdown notification bell in the Navbar.
    - [ ] Support for persistent notifications (stored in DB) and ephemeral toasts.
