# Design System Implementation

## Overview
Comprehensive design system for ArenaX frontend with atomic design principles, consistent styling, and accessibility-first approach.

## Design Tokens

### Colors
```typescript
// Primary Colors
primary: {
  DEFAULT: '#3B82F6',  // Blue 500
  light: '#60A5FA',    // Blue 400
  dark: '#2563EB',     // Blue 600
  foreground: '#FFFFFF'
}

// Secondary Colors
secondary: {
  DEFAULT: '#6B7280',  // Gray 500
  light: '#9CA3AF',    // Gray 400
  dark: '#4B5563',     // Gray 600
  foreground: '#FFFFFF'
}

// Accent Colors
accent: {
  DEFAULT: '#8B5CF6',  // Violet 500
  light: '#A78BFA',    // Violet 400
  dark: '#7C3AED',     // Violet 600
  foreground: '#FFFFFF'
}

// Semantic Colors
destructive: {
  DEFAULT: '#EF4444',  // Red 500
  foreground: '#FFFFFF'
}

success: {
  DEFAULT: '#10B981',  // Emerald 500
  foreground: '#FFFFFF'
}

warning: {
  DEFAULT: '#F59E0B',  // Amber 500
  foreground: '#FFFFFF'
}
```

### Spacing Scale
```typescript
spacing: {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px'
}
```

### Typography Scale
```typescript
fontSizes: {
  xs: '0.75rem',    // 12px
  sm: '0.875rem',   // 14px
  base: '1rem',     // 16px
  lg: '1.125rem',   // 18px
  xl: '1.25rem',    // 20px
  '2xl': '1.5rem',  // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem', // 36px
  '5xl': '3rem'     // 48px
}

fontWeights: {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700
}

lineHeights: {
  tight: 1.25,
  normal: 1.5,
  relaxed: 1.75
}
```

### Border Radius
```typescript
borderRadius: {
  none: '0px',
  sm: '2px',
  DEFAULT: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  '2xl': '16px',
  full: '9999px'
}
```

### Shadows
```typescript
shadows: {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'
}
```

## Component Patterns

### Button Variants
- **Primary**: Main actions, high visibility
- **Secondary**: Alternative actions, medium visibility
- **Outline**: Low emphasis actions
- **Ghost**: Minimal emphasis, hover states
- **Destructive**: Destructive actions (delete, remove)

### Input States
- **Default**: Normal state
- **Focus**: Active input state
- **Error**: Validation error state
- **Disabled**: Non-interactive state

### Card Components
- **Card**: Container with border and shadow
- **CardHeader**: Title and description area
- **CardContent**: Main content area
- **CardFooter**: Action buttons area

## Accessibility Standards

### Color Contrast
- Normal text: 4.5:1 minimum
- Large text: 3:1 minimum
- UI components: 3:1 minimum

### Keyboard Navigation
- Tab order: Logical, left-to-right, top-to-bottom
- Focus indicators: Visible, 2px minimum
- Skip links: Present for main content

### ARIA Attributes
- Labels: All interactive elements labeled
- Roles: Appropriate ARIA roles
- States: Current states communicated
- Live regions: Dynamic content announced

## Responsive Breakpoints

```typescript
breakpoints: {
  sm: '640px',   // Mobile landscape
  md: '768px',   // Tablet
  lg: '1024px',  // Desktop
  xl: '1280px',  // Large desktop
  '2xl': '1536px' // Extra large desktop
}
```

## Animation Standards

### Durations
```typescript
durations: {
  fast: '150ms',
  normal: '300ms',
  slow: '500ms'
}
```

### Easing
```typescript
easings: {
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
}
```

### Reduced Motion
- Respect `prefers-reduced-motion`
- Provide non-animated alternatives
- Disable parallax and complex animations

## Usage Guidelines

### Component Usage
1. Always use atomic components when possible
2. Compose molecules from atoms
3. Build organisms from molecules
4. Follow the component hierarchy

### Styling
1. Use design tokens instead of hardcoded values
2. Follow the spacing scale
3. Use semantic color names
4. Maintain consistent border radius

### Accessibility
1. Test with screen readers
2. Verify keyboard navigation
3. Check color contrast
4. Use semantic HTML

## Documentation

### Component Documentation Template
```markdown
# ComponentName

## Description
Brief description of the component's purpose and usage.

## Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| prop | string | 'default' | Description |

## Variants
- **variant1**: Description
- **variant2**: Description

## Accessibility
- ARIA attributes used
- Keyboard navigation support
- Screen reader announcements

## Examples
```tsx
<ComponentName prop="value" />
```
```

## Storybook Integration

### Story Structure
```typescript
export default {
  title: 'Atoms/Button',
  component: Button,
  tags: ['autodocs'],
} as ComponentMeta<typeof Button>;

export const Primary: ComponentStory<typeof Button> = {
  args: {
    variant: 'primary',
    children: 'Click me',
  },
};
```

### Accessibility Testing
- Integrate @storybook/addon-a11y
- Run axe-core tests
- Document accessibility issues

## Governance

### Component Creation Process
1. Create component in appropriate directory
2. Add TypeScript types
3. Implement variants using CVA
4. Add Storybook stories
5. Write accessibility tests
6. Document usage and props
7. Submit for code review

### Code Review Checklist
- [ ] Follows atomic design principles
- [ ] Uses design tokens
- [ ] TypeScript types complete
- [ ] Accessibility compliant
- [ ] Storybook stories present
- [ ] Documentation complete
- [ ] Tests passing
