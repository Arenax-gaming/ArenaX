# Search Enhancement Guide

This guide explains the advanced search implementation in ArenaX, which includes debouncing, caching, suggestions, and history.

## Features

### 1. useSearch Hook

The `useSearch` hook provides a complete search solution with:

- **Debouncing**: 300ms delay to prevent excessive API calls
- **Result Caching**: 5-minute TTL with 50-item limit
- **Search History**: Persists to localStorage (10 items max)
- **Suggestions**: Auto-generated from search results
- **Request Cancellation**: Aborts pending requests on new searches

### 2. Usage Example

```tsx
import { useSearch } from '@/hooks/useSearch';

function MyComponent() {
  const {
    query,
    setQuery,
    debouncedQuery,
    results,
    isLoading,
    error,
    searchHistory,
    clearHistory,
    removeFromHistory,
    suggestions,
    clearCache,
    refetch,
  } = useSearch(
    async (query: string) => {
      const response = await fetch(`/api/search?q=${query}`);
      return response.json();
    },
    {
      debounceMs: 300,
      cacheKey: 'my_search',
      maxCacheSize: 50,
      maxHistorySize: 10,
      minSearchLength: 2,
    }
  );

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      {isLoading && <p>Loading...</p>}
      {results.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  );
}
```

### 3. SearchSuggestions Component

The `SearchSuggestions` component provides a dropdown with:

- **Suggestions**: Auto-generated from search results
- **History**: Recent searches with clear/remove options
- **Loading State**: Shows spinner during search
- **Keyboard Navigation**: Accessible dropdown

```tsx
import { SearchSuggestions } from '@/components/ui/SearchSuggestions';

<SearchSuggestions
  suggestions={suggestions}
  searchHistory={searchHistory}
  query={query}
  onSelectSuggestion={setQuery}
  onClearHistory={clearHistory}
  onRemoveFromHistory={removeFromHistory}
  isLoading={isLoading}
/>
```

### 4. Integration with TournamentFilter

The TournamentFilter component now uses the `useDebounce` hook from `useSearch`:

```tsx
import { useDebounce } from '@/hooks/useSearch';

const debouncedSearch = useDebounce(search, 300);
```

### 5. Performance Benefits

- **Reduced API Calls**: Debouncing prevents excessive requests
- **Faster Responses**: Caching serves repeated queries instantly
- **Better UX**: History provides quick access to recent searches
- **Network Efficiency**: Request cancellation saves bandwidth

### 6. Best Practices

1. **Always use useSearch** for search functionality
2. **Set appropriate debounce** (300ms default is good for most cases)
3. **Use cacheKey** to separate different search contexts
4. **Clear cache** when data changes
5. **Handle errors** gracefully in your search function
6. **Set minSearchLength** to avoid unnecessary searches

### 7. Migration Checklist

- [x] Create useSearch hook with debouncing and caching
- [x] Add search history with localStorage persistence
- [x] Implement search suggestions
- [x] Create SearchSuggestions component
- [x] Integrate with TournamentFilter
- [x] Add search documentation
- [ ] Add search testing
- [ ] Implement keyboard shortcuts
- [ ] Add search analytics

## Testing

Search functionality can be tested by:
1. Verifying debouncing with rapid input
2. Checking cache hits on repeated queries
3. Testing history persistence across sessions
4. Validating suggestion generation
5. Measuring API call reduction
