# Atomic Design Architecture

## Overview
Implementation of atomic design pattern for ArenaX frontend components to improve maintainability, reusability, and consistency.

## Atomic Design Hierarchy

### 1. Atoms
Basic building blocks that cannot be broken down further.
- **Location**: `src/components/atoms/`
- **Examples**: Button, Input, Badge, Icon, Typography
- **Characteristics**: Single responsibility, no logic, pure UI

### 2. Molecules
Groups of atoms that function together as a unit.
- **Location**: `src/components/molecules/`
- **Examples**: Form, Card, SearchBar, FormGroup
- **Characteristics**: Simple logic, composed of atoms

### 3. Organisms
Complex UI sections composed of molecules and atoms.
- **Location**: `src/components/organisms/`
- **Examples**: TournamentBracket, Leaderboard, ProfileHeader
- **Characteristics**: Complex logic, business rules

### 4. Templates
Page-level structures that define layout.
- **Location**: `src/components/templates/`
- **Examples**: DashboardLayout, TournamentLayout, ProfileLayout
- **Characteristics**: Layout structure, placeholder content

### 5. Pages
Complete pages with actual content.
- **Location**: `src/app/[locale]/pages/`
- **Examples**: Dashboard, TournamentDetail, Profile
- **Characteristics**: Route-level, data fetching

## Component Migration Strategy

### Phase 1: Atoms (Current)
Move existing basic UI components to atoms/:
- Button.tsx
- Input.tsx
- Badge.tsx
- Card.tsx
- Switch.tsx
- Select.tsx
- Tooltip.tsx
- Modal.tsx

### Phase 2: Molecules
Create molecules from combinations:
- Form (Input + Button + Validation)
- DataTable (Card + Table + Pagination)
- SearchBar (Input + Button + Suggestions)
- FileUpload (Input + Button + Progress)

### Phase 3: Organisms
Organize feature components:
- TournamentBracket (Molecule + Logic)
- Leaderboard (DataTable + Logic)
- ProfileHeader (Card + Avatar + Stats)

### Phase 4: Templates
Create layout templates:
- DashboardLayout
- TournamentLayout
- ProfileLayout
- SettingsLayout

## Design System Integration

### Design Tokens
- **Location**: `src/components/atoms/design-tokens.ts`
- **Content**: Colors, spacing, typography, shadows, borders
- **Usage**: Import and use across all components

### Component Variants
- Use `class-variance-authority` for variants
- Consistent naming: `variant="primary"`, `size="lg"`
- Document all variants in Storybook

### Accessibility
- All atoms must be accessible
- ARIA labels, keyboard navigation
- Test with axe-core

## Documentation

### Component Documentation
Each component must include:
- Description
- Props interface
- Usage examples
- Accessibility notes
- Variant examples

### Storybook
- Stories for all atoms and molecules
- Document variants and states
- Accessibility tests integrated

## Governance

### Component Creation Rules
1. Start with atoms - build up from there
2. Single responsibility principle
3. Reusability over specificity
4. Accessibility first
5. TypeScript strict mode

### Code Review Checklist
- [ ] Follows atomic hierarchy
- [ ] Proper TypeScript types
- [ ] Accessibility compliant
- [ ] Has Storybook stories
- [ ] Documented props
- [ ] No business logic in atoms
- [ ] Proper error boundaries

## Migration Status
- [x] Analyze current component structure
- [ ] Create atoms directory structure
- [ ] Migrate existing atoms
- [ ] Create molecules directory
- [ ] Build molecules from atoms
- [ ] Create organisms directory
- [ ] Organize feature components
- [ ] Create templates
- [ ] Update imports across codebase
- [ ] Update Storybook
- [ ] Document components
