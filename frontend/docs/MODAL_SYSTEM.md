# Modal System Guide

This guide explains the advanced modal system implementation in ArenaX, which includes focus management, accessibility, stacking, and animations.

## Features

### 1. Modal Component

The `Modal` component provides a complete modal solution with:

- **Focus Management**: Traps focus within modal, restores focus on close
- **Accessibility**: Full ARIA support, keyboard navigation, screen reader friendly
- **Modal Stacking**: Supports nested modals with proper z-index management
- **Animation**: Smooth animations with reduced motion support
- **Flexible Positioning**: Center, top, or bottom positioning
- **Multiple Sizes**: sm, md, lg, xl, full width options
- **Escape & Overlay**: Configurable close behaviors

### 2. Usage Example

```tsx
import { Modal } from '@/components/ui/Modal';
import { useState } from 'react';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>Open Modal</button>
      
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="My Modal"
        size="lg"
        position="center"
        closeOnOverlayClick={true}
        closeOnEscape={true}
        showCloseButton={true}
      >
        <p>Modal content goes here</p>
      </Modal>
    </>
  );
}
```

### 3. Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | required | Controls modal visibility |
| `onClose` | `() => void` | required | Called when modal closes |
| `title` | `string` | optional | Modal title displayed in header |
| `children` | `ReactNode` | required | Modal content |
| `size` | `"sm" \| "md" \| "lg" \| "xl" \| "full"` | `"md"` | Modal max-width |
| `position` | `"center" \| "top" \| "bottom"` | `"center"` | Modal vertical position |
| `closeOnOverlayClick` | `boolean` | `true` | Close when clicking overlay |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key |
| `showCloseButton` | `boolean` | `true` | Show X button in header |

### 4. useModalStack Hook

For managing multiple modals (nested modals):

```tsx
import { useModalStack } from '@/components/ui/Modal';

function MyComponent() {
  const { modalStack, addModal, removeModal, closeModal } = useModalStack();

  const openModal = (id: string) => {
    addModal(id, () => console.log('close', id));
  };

  return (
    <>
      <button onClick={() => openModal('modal-1')}>Open Modal 1</button>
      <button onClick={() => openModal('modal-2')}>Open Modal 2</button>
      <button onClick={closeModal}>Close Top Modal</button>
    </>
  );
}
```

### 5. Accessibility Features

- **Focus Trap**: Tab cycles through focusable elements within modal
- **Focus Restoration**: Returns focus to triggering element on close
- **ARIA Attributes**: Proper `role="dialog"`, `aria-modal`, `aria-labelledby`
- **Keyboard Navigation**: Escape to close, Tab to navigate
- **Screen Reader**: Announces modal title and content
- **Reduced Motion**: Respects `prefers-reduced-motion` preference

### 6. Animation

The modal uses `framer-motion` for smooth animations:
- **Fade In/Out**: Overlay and modal fade
- **Scale & Slide**: Modal scales up and slides into position
- **Reduced Motion**: Disables animations for users who prefer it

### 7. Best Practices

1. **Always provide onClose** to handle modal closing
2. **Use descriptive titles** for screen readers
3. **Keep modals focused** on single tasks
4. **Avoid nesting too deeply** (max 2-3 levels)
5. **Test keyboard navigation** thoroughly
6. **Provide clear close actions** (button, escape, overlay)

### 8. Migration Checklist

- [x] Create Modal component with focus management
- [x] Add accessibility features (ARIA, keyboard)
- [x] Implement modal stacking with useModalStack
- [x] Add animation support with reduced motion
- [x] Support multiple sizes and positions
- [x] Add modal documentation
- [ ] Update existing modals to use new system
- [ ] Add modal testing
- [ ] Implement modal transitions

## Testing

Modal functionality can be tested by:
1. Verifying focus trap with Tab key
2. Testing Escape key to close
3. Checking overlay click behavior
4. Validating focus restoration on close
5. Testing nested modal stacking
6. Verifying reduced motion preference
7. Testing with screen reader
