"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Shield, Mail, User, Lock, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import {
  accountSettingsSchema,
  type AccountSettingsFormData,
} from "@/lib/validations/auth";
import type { AccountSettings as AccountSettingsType } from "@/types/settings";

interface AccountSettingsProps {
  settings: AccountSettingsType;
  onUpdate: (updates: Partial<AccountSettingsType>) => void;
  onSave: () => Promise<boolean>;
  isSaving: boolean;
  getFieldError: (field: string) => string | undefined;
}

export function AccountSettings({
  settings,
  onUpdate,
  onSave,
  isSaving,
  getFieldError,
}: AccountSettingsProps) {
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [passwordChangeExpanded, setPasswordChangeExpanded] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const form = useForm<AccountSettingsFormData>({
    resolver: zodResolver(accountSettingsSchema),
    defaultValues: {
      email: settings.email,
      username: settings.username,
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
      twoFactorEnabled: settings.twoFactorEnabled,
    },
    mode: "onTouched",
  });

  const togglePasswordVisibility = (field: "current" | "new" | "confirm") => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSave = form.handleSubmit(async (data) => {
    // Sync validated data back to the useSettings store
    onUpdate({
      email: data.email,
      username: data.username,
      currentPassword: data.currentPassword ?? "",
      newPassword: data.newPassword ?? "",
      confirmNewPassword: data.confirmNewPassword ?? "",
      twoFactorEnabled: data.twoFactorEnabled,
    });

    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setPasswordChangeExpanded(false);
      form.resetField("currentPassword");
      form.resetField("newPassword");
      form.resetField("confirmNewPassword");
      setTimeout(() => setSaveSuccess(false), 3000);
    } else {
      // Surface errors from useSettings back into the form
      const emailErr = getFieldError("email");
      const pwErr = getFieldError("newPassword");
      const confirmErr = getFieldError("confirmNewPassword");
      if (emailErr) form.setError("email", { message: emailErr });
      if (pwErr) form.setError("newPassword", { message: pwErr });
      if (confirmErr) form.setError("confirmNewPassword", { message: confirmErr });
    }
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Account Settings</CardTitle>
            <CardDescription>
              Manage your account information and security
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <Form {...form}>
          <form onSubmit={handleSave} noValidate className="space-y-6">
            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    Email Address
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <input
                        {...field}
                        type="email"
                        onChange={(e) => {
                          field.onChange(e);
                          onUpdate({ email: e.target.value });
                        }}
                        className="w-full pl-10 pr-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="your@email.com"
                      />
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Username */}
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    Username
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <input
                        {...field}
                        type="text"
                        onChange={(e) => {
                          field.onChange(e);
                          onUpdate({ username: e.target.value });
                        }}
                        className="w-full pl-10 pr-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Your username"
                      />
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Password Change Section */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setPasswordChangeExpanded(!passwordChangeExpanded)}
                className="w-full flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                aria-expanded={passwordChangeExpanded}
              >
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Change Password</span>
                </div>
                <svg
                  className={`h-4 w-4 transition-transform ${
                    passwordChangeExpanded ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {passwordChangeExpanded && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  {/* Current Password */}
                  <FormField
                    control={form.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <input
                              {...field}
                              type={showPasswords.current ? "text" : "password"}
                              className="w-full pl-10 pr-10 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              placeholder="Enter current password"
                            />
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <button
                              type="button"
                              onClick={() => togglePasswordVisibility("current")}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              aria-label={
                                showPasswords.current
                                  ? "Hide current password"
                                  : "Show current password"
                              }
                            >
                              {showPasswords.current ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* New Password */}
                  <FormField
                    control={form.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <input
                              {...field}
                              type={showPasswords.new ? "text" : "password"}
                              className="w-full pl-10 pr-10 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              placeholder="Enter new password"
                            />
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <button
                              type="button"
                              onClick={() => togglePasswordVisibility("new")}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              aria-label={
                                showPasswords.new
                                  ? "Hide new password"
                                  : "Show new password"
                              }
                            >
                              {showPasswords.new ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Confirm New Password */}
                  <FormField
                    control={form.control}
                    name="confirmNewPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm New Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <input
                              {...field}
                              type={showPasswords.confirm ? "text" : "password"}
                              className="w-full pl-10 pr-10 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              placeholder="Confirm new password"
                            />
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <button
                              type="button"
                              onClick={() => togglePasswordVisibility("confirm")}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              aria-label={
                                showPasswords.confirm
                                  ? "Hide confirm password"
                                  : "Show confirm password"
                              }
                            >
                              {showPasswords.confirm ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            {/* Two-Factor Authentication */}
            <FormField
              control={form.control}
              name="twoFactorEnabled"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          field.value ? "bg-success/10" : "bg-muted"
                        }`}
                      >
                        <Shield
                          className={`h-5 w-5 ${
                            field.value ? "text-success" : "text-muted-foreground"
                          }`}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          Two-Factor Authentication
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {field.value
                            ? "Enabled"
                            : "Add extra security to your account"}
                        </p>
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          onUpdate({ twoFactorEnabled: checked });
                        }}
                      />
                    </FormControl>
                  </div>
                </FormItem>
              )}
            />

            {/* Root form error */}
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            {/* Save Button */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              {saveSuccess && (
                <span className="text-sm text-success flex items-center gap-1">
                  <Check className="h-4 w-4" />
                  Settings saved successfully
                </span>
              )}
              <Button
                type="submit"
                variant="primary"
                loading={isSaving}
                disabled={isSaving}
              >
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
