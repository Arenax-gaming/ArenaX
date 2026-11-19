import type { Meta, StoryObj } from "@storybook/react";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./Form";
import { Input } from "../atoms/Input";
import { Button } from "../atoms/Button";

interface ProfileFormValues {
  username: string;
  email: string;
}

const meta = {
  title: "Molecules/Form",
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ProfileForm({
  defaultValues,
  withError = false,
}: {
  defaultValues: ProfileFormValues;
  withError?: boolean;
}) {
  const form = useForm<ProfileFormValues>({
    defaultValues,
    ...(withError
      ? {
          errors: {
            email: { type: "manual", message: "Enter a valid email address" },
          },
        }
      : {}),
  });

  return (
    <Form {...form}>
      <form
        className="w-80 space-y-6"
        onSubmit={form.handleSubmit(() => undefined)}
      >
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="redman9" {...field} />
              </FormControl>
              <FormDescription>
                This is how other players will see you.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Save profile</Button>
      </form>
    </Form>
  );
}

export const Playground: Story = {
  render: () => (
    <ProfileForm defaultValues={{ username: "", email: "" }} />
  ),
};

export const Filled: Story = {
  render: () => (
    <ProfileForm
      defaultValues={{ username: "redman9", email: "redman9@example.com" }}
    />
  ),
};

export const ValidationError: Story = {
  render: () => (
    <ProfileForm
      defaultValues={{ username: "redman9", email: "not-an-email" }}
      withError
    />
  ),
};
