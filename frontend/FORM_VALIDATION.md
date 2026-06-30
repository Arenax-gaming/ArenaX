# Form Validation Architecture

All forms in ArenaX use **React Hook Form** with **Zod** schemas for type-safe, consistent, and performant validation.

---

## Stack

| Layer | Library | Purpose |
|---|---|---|
| Form state | `react-hook-form` | Field registration, validation, submission |
| Schema | `zod` | Type-safe validation rules |
| Resolver | `@hookform/resolvers/zod` | Bridges RHF + Zod |
| UI primitives | `src/components/ui/Form.tsx` | Composable form building blocks |
| Analytics | `src/hooks/useFormAnalytics.ts` | Tracks starts, submits, errors, abandons |

---

## Schemas

All schemas live in `src/lib/validations/` and are exported from the index:

```ts
import { loginSchema, registerSchema } from '@/lib/validations';
```

| File | Exports |
|---|---|
| `auth.ts` | `loginSchema`, `registerSchema`, `passwordResetRequestSchema`, `passwordResetSchema`, `accountSettingsSchema` |
| `profile.ts` | `profileBioSchema`, `profileEditSchema` |
| `contact.ts` | `contactSchema` |
| `wallet.ts` | `withdrawSchema`, `depositSchema` |
| `tournament.ts` | `tournamentRegistrationSchema` |

---

## UI Primitives

`src/components/ui/Form.tsx` exports composable components based on React Hook Form's `Controller`:

```tsx
import {
  Form,         // wraps FormProvider
  FormField,    // Controller wrapper — provides field context
  FormItem,     // spacing container, provides id context
  FormLabel,    // <label> — auto-links to FormControl id, turns red on error
  FormControl,  // applies aria-describedby and aria-invalid
  FormDescription, // hint text
  FormMessage,  // renders field error or custom children
} from '@/components/ui/Form';
```

### Basic Usage

```tsx
const form = useForm<MyFormData>({
  resolver: zodResolver(mySchema),
  defaultValues: { email: '' },
});

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
    <FormField
      control={form.control}
      name="email"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Email</FormLabel>
          <FormControl>
            <Input {...field} type="email" error={!!form.formState.errors.email} />
          </FormControl>
          <FormDescription>We'll never share your email.</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
    <Button type="submit">Submit</Button>
  </form>
</Form>
```

---

## Validation Modes

| Form | Mode | Reason |
|---|---|---|
| Login | default (onSubmit) | Minimal noise for a simple 2-field form |
| Register | `onTouched` | Provides feedback after each field is visited |
| Profile edit | `onTouched` | Long form; validate after leaving each field |
| Account settings | `onTouched` | Password strength feedback is progressive |
| Others | default | Quick modals; validate on submit |

---

## Form Analytics

Every form is instrumented via `useFormAnalytics`:

```ts
const analytics = useFormAnalytics('login');
analytics.trackStart();           // call on first user interaction
analytics.trackSubmit({ success: true/false });
analytics.trackError('email', 'Invalid email'); // per-field errors
analytics.trackAbandon();         // call on unmount if dirty
```

Events are sent to **Datadog RUM** in production, and logged to the console in development.

---

## Error Handling Pattern

1. **Field errors** — `<FormMessage />` renders the Zod message automatically.
2. **Root/submission errors** — use `form.setError('root', { message })` for server errors, rendered as a banner:

```tsx
{form.formState.errors.root && (
  <div role="alert" className="...">
    {form.formState.errors.root.message}
  </div>
)}
```

3. **Async server errors** — catch in `onSubmit`, call `form.setError` on the specific field:

```ts
catch (err) {
  if (err.code === 'EMAIL_EXISTS') {
    form.setError('email', { message: 'Email already in use' });
  }
}
```

---

## Accessibility

All form primitives follow WCAG 2.1 AA:

- `<FormControl>` sets `aria-invalid` and `aria-describedby` automatically
- `<FormMessage>` renders with `role="alert"` and `aria-live="polite"`
- Labels use `htmlFor` linked to the control `id` via `useFormField()`
- `noValidate` on `<form>` disables native browser validation bubbles in favour of our custom UI
- Password visibility toggles have descriptive `aria-label` attributes

---

## Testing

Use helpers from `src/lib/testing/formTestUtils.tsx`:

```ts
import { renderForm, fillField, submitForm, expectFieldError } from '@/lib/testing/formTestUtils';

test('shows email error on invalid input', async () => {
  renderForm(<LoginForm />);
  await fillField('Email', 'notvalid');
  await submitForm(/sign in/i);
  await expectFieldError('Invalid email address');
});
```

Schema unit tests are in `src/lib/validations/__tests__/schemas.test.ts`. Run with:

```bash
npm test -- schemas.test.ts
```

---

## Adding a New Form

1. Define a Zod schema in `src/lib/validations/<domain>.ts`
2. Export from `src/lib/validations/index.ts`
3. Use `useForm` with `zodResolver` in your component
4. Wrap with `<Form {...form}>` and use `<FormField>` for each input
5. Add `useFormAnalytics` for tracking
6. Write schema tests in `src/lib/validations/__tests__/schemas.test.ts`
