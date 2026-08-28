# Pull Request: Match History Filters & Sorting

## Issue
Closes #931

## Summary
Added filtering, sorting, and URL state management to the MatchHistory component for enhanced user experience.

## Changes

### Features Added
- **Filtering**
  - Filter by opponent name (search)
  - Filter by game type
  - Filter by result (win/loss/all)
  - Filter by time range (all time, past week, past month)

- **Sorting**
  - Sort by date (ascending/descending)
  - Sort by ELO change (ascending/descending)
  - Sort by match duration (ascending/descending)
  - Visual indicators for active sort

- **URL State Management**
  - All filters persisted in URL query parameters
  - Filter state survives page refresh
  - Shareable URLs with active filters

- **UX Improvements**
  - "Clear All Filters" button
  - Individual filter clear buttons
  - Saved filter preferences via URL
  - Better organized filter panel with sorting controls

### Technical Details
- Uses Next.js `useSearchParams`, `useRouter`, `usePathname` for URL state
- Filters merged with props (props take precedence)
- URL updates without full page reload (`scroll: false`)
- Sort direction toggles between asc/desc on repeated clicks

## Testing
- [x] Filters work correctly with all combinations
- [x] Sorting works for all three fields
- [x] URL updates when filters change
- [x] Clear all filters button works
- [x] Filter state persists on refresh

## UI Preview

### Filter Panel (Expanded)
```
┌─────────────────────────────────────────┐
│ Sort By                                 │
│ [Date ▼] [ELO ▼] [Duration ▼]          │
├─────────────────────────────────────────┤
│ Filter by time range                    │
│ [All Time] [Past Week] [Past Month]    │
├─────────────────────────────────────────┤
│ Game Type ▼                             │
│ [All Types ▼]                           │
├─────────────────────────────────────────┤
│ Filter by result                        │
│ [All] [Wins] [Losses]                   │
├─────────────────────────────────────────┤
│ [🔍 Search opponent...          X]       │
│                                         │
│              [Clear All Filters]        │
└─────────────────────────────────────────┘
```

## Files Modified
- `frontend/src/components/profile/MatchHistory.tsx`
  - Added `MatchHistorySort` interface
  - Added `parseFiltersFromURL()` helper
  - Added `buildSearchParamsString()` helper
  - Enhanced `handleFilterChange()` to update URL
  - Added `toggleSort()` and `getSortIndicator()` helpers
  - Updated `clearFilters()` to clear URL state
  - Added sort controls to filter panel
  - Added duration display to match rows
  - Added X icon on opponent search clear