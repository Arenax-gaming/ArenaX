# ArenaX Core Flows Accessibility Manual Audit & Verification Guide

This document records the manual testing procedures, findings, and screen reader / keyboard verification protocols for the four core ArenaX workflows (Issue #40):
1. Authentication (Login / Register)
2. Tournament Entry
3. Dual Match Score Reporting & Disputes
4. Wallet (Deposit / Withdrawal State Flows)

---

## 1. Dynamic Updates & Screen Reader Announcements

| Flow | Dynamic Trigger | Live Region Level | Announcement Content | Verification Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Match Relay** | WebSocket status change | `aria-live="polite"` | `"Match status changed to [status]"` | Non-disruptive, announced when series transitions from scheduled to live. |
| **Match Relay** | WebSocket reconnection | `role="status"` | `"Connection restored. Live updates resumed."` | Rendered with `role="status"` on connection restored banner. |
| **Score Submission** | User submits score | `aria-live="polite"` | `"Your score report has been submitted and is waiting for final confirmation."` | Announces submission success without clearing focus from active button. |
| **Score Conflict** | Opponent score mismatch | `aria-live="assertive"` | `"Conflict detected: Your submission conflicts with the opponent report. ArenaX flagged the series for review."` | High priority; interrupts queue to notify player immediately of dispute hold. |
| **Deposit State** | Gateway Callback Return | `aria-live="polite"` | `"Verifying payment with [Provider]..."` | Informs user that return URL is undergoing authoritative verification. |
| **Deposit State** | Verification Completed | `aria-live="polite"` | `"Deposit successful! [Amount] credited to your wallet balance."` | Clear monetary confirmation. |

---

## 2. Dialog Focus Management & Restoration

All application modals (`QuickJoinModal`, `DepositModal`, `WithdrawModal`, `BracketMatchModal`) strictly follow the WAI-ARIA Dialog (Modal) Pattern:

- **Opening**:
  - Focus is moved to the modal container or the primary interactive control (e.g. entry confirmation input or amount field).
  - The previously active trigger element (e.g., "Join Tournament", "Deposit", "Withdraw", or match card button) is captured via `useRef<HTMLElement>`.
- **Focus Trapping**:
  - `Tab` and `Shift + Tab` cycle exclusively through focusable elements inside the modal. Focus cannot escape into background DOM while open.
- **Escape Key**:
  - Pressing `Escape` triggers `onClose()`.
- **Restoration**:
  - When the dialog closes (via Escape, Cancel button, or successful submission), focus is reliably restored to the original trigger element.

---

## 3. Keyboard Navigation Paths

### Authentication Flow
1. Tab from Address bar -> Skip Link -> Logo -> Main Navigation.
2. In `LoginForm`:
   - `Tab` -> `Email input` (has visible outline `ring-2 ring-primary`)
   - `Tab` -> `Password input`
   - `Tab` -> `Forgot password?` link
   - `Tab` -> `Remember me` checkbox (space bar toggles)
   - `Tab` -> `Sign in` button (`Enter` submits form)
   - `Tab` -> Social login buttons -> `Continue as guest`

### Tournament Entry Flow
1. Navigate to tournament card -> `Tab` to `JoinTournamentButton` (`Enter` activates).
2. `QuickJoinModal` opens -> Focus moved inside dialog.
3. User tabs through fee breakdown (`25.00 XLM`), refund terms (`100% refundable prior to bracket lock`).
4. `Tab` to `I accept terms` checkbox -> `Space` to check.
5. `Tab` to `Confirm Entry` button -> `Enter` sends idempotent join request (`Idempotency-Key` header).
6. Success state shows seat confirmation; closing dialog restores focus to `JoinTournamentButton`.

### Match Reporting Flow
1. `Tab` to Player 1 Score input (`aria-label="Player 1 Score"`).
2. Enter score -> `Tab` to Player 2 Score input (`aria-label="Player 2 Score"`).
3. `Tab` to `Submit Verified Score` button -> `Enter` executes submission.
4. If opponent report matches, series resolves; if reports conflict, `aria-live="assertive"` announces discrepancy and focus can advance to `Open Dispute Evidence Flow`.

### Wallet Deposit & Withdrawal Flows
1. `DepositModal`:
   - Dual rail selection (Crypto vs Fiat) navigable with arrow keys / tab.
   - Fiat form verifies amount, shows provider fees and limits before irreversible action.
   - Pending transactions display "Verify Status" button in `TransactionHistory` with full keyboard accessibility.
2. `WithdrawModal`:
   - Step 1 (Intent): Amount, Destination Address, optional Memo.
   - Step 2 (Confirmation): Summary card displays amount, 0.00001 XLM network fee, remaining balance, destination, and warning.
   - Focus trap ensures user cannot accidentally submit without inspecting fee and address.

---

## 4. Automated Axe & Semantic Association Checks

- **FormControl Slot Integration**:
  - `Form.tsx` now leverages Radix UI's `Slot` component.
  - Form attributes (`id`, `aria-describedby`, `aria-invalid`) are bound directly to native `<input>` elements rather than wrapping `<div>`s.
  - Eliminates orphan labels and ensures axe rule `label` passes on all forms.
- **Minimum Touch Targets**:
  - All interactive buttons, tabs, and form controls enforce `min-h-[44px]` and `min-w-[44px]`.
- **Visible Focus Indicator**:
  - All interactive elements use `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`.
