"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Shield, Mail, User, Lock, Check, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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

  const handleSave = async () => {
    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setPasswordChangeExpanded(false);
      onUpdate({
        currentPassword: "",
        newPassword: "",
        confirmNewPassword: "",
      });
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const togglePasswordVisibility = (field: "current" | "new" | "confirm") => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <User className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <CardTitle>Account Settings</CardTitle>
            <CardDescription>Manage your account information and security</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Email Address
          </label>
          <div className="relative">
            <input
              type="email"
              value={settings.email}
              onChange={(e) => onUpdate({ email: e.target.value })}
              className="w-full pl-10 pr-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="your@email.com"
            />
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
          {getFieldError("email") && (
            <p className="text-sm text-red-500 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {getFieldError("email")}
            </p>
          )}
        </div>

        {/* Username */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            Username
          </label>
          <div className="relative">
            <input
              type="text"
              value={settings.username}
              onChange={(e) => onUpdate({ username: e.target.value })}
              className="w-full pl-10 pr-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Your username"
            />
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Password Change Section */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setPasswordChangeExpanded(!passwordChangeExpanded)}
            className="w-full flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Change Password</span>
            </div>
            <svg
              className={`h-4 w-4 transition-transform ${passwordChangeExpanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {passwordChangeExpanded && (
            <div className="space-y-4 pl-4 border-l-2 border-muted">
              {/* Current Password */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Current Password</label>
                <div className="relative">
                  <input
                    type={showPasswords.current ? "text" : "password"}
                    value={settings.currentPassword}
                    onChange={(e) => onUpdate({ currentPassword: e.target.value })}
                    className="w-full pl-10 pr-10 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter current password"
                  />
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility("current")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswords.current ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-2">
                <label className="text-sm font-medium">New Password</label>
                <div className="relative">
                  <input
                    type={showPasswords.new ? "text" : "password"}
                    value={settings.newPassword || ""}
                    onChange={(e) => onUpdate({ newPassword: e.target.value })}
                    className="w-full pl-10 pr-10 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter new password"
                  />
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility("new")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {getFieldError("newPassword") && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {getFieldError("newPassword")}
                  </p>
                )}
              </div>

              {/* Confirm New Password */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showPasswords.confirm ? "text" : "password"}
                    value={settings.confirmNewPassword || ""}
                    onChange={(e) => onUpdate({ confirmNewPassword: e.target.value })}
                    className="w-full pl-10 pr-10 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Confirm new password"
                  />
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility("confirm")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {getFieldError("confirmNewPassword") && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {getFieldError("confirmNewPassword")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Two-Factor Authentication */}
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${settings.twoFactorEnabled ? "bg-green-500/10" : "bg-muted"}`}>
              <Shield className={`h-5 w-5 ${settings.twoFactorEnabled ? "text-green-500" : "text-muted-foreground"}`} />
            </div>
            <div>
              <p className="text-sm font-medium">Two-Factor Authentication</p>
              <p className="text-xs text-muted-foreground">
                {settings.twoFactorEnabled ? "Enabled" : "Add extra security to your account"}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.twoFactorEnabled}
              onChange={(e) => onUpdate({ twoFactorEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t">
          {saveSuccess && (
            <span className="text-sm text-green-500 flex items-center gap-1">
              <Check className="h-4 w-4" />
              Settings saved successfully
            </span>
          )}
          <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={isSaving}>
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}