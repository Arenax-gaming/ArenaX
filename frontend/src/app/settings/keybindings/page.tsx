"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, User, Gamepad2, Bell, Lock, Accessibility, Palette, Keyboard } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { KeyBindings } from "@/components/settings/KeyBindings";

const navigationItems = [
  {
    href: "/settings/account",
    label: "Account",
    description: "Email, password, and security",
    icon: User,
    active: false,
  },
  {
    href: "/settings/game",
    label: "Game",
    description: "Graphics, audio, and gameplay",
    icon: Gamepad2,
    active: false,
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    description: "Alerts and communication",
    icon: Bell,
    active: false,
  },
  {
    href: "/settings/privacy",
    label: "Privacy",
    description: "Data and visibility controls",
    icon: Lock,
    active: false,
  },
  {
    href: "/settings/accessibility",
    label: "Accessibility",
    description: "Inclusive design features",
    icon: Accessibility,
    active: false,
  },
  {
    href: "/settings/theme",
    label: "Theme",
    description: "Visual customization",
    icon: Palette,
    active: false,
  },
  {
    href: "/settings/keybindings",
    label: "Key Bindings",
    description: "Control customization",
    icon: Keyboard,
    active: true,
  },
];

export default function KeyBindingsSettingsPage() {
  const {
    settings,
    isSaving,
    updateGame,
    saveSettings,
    updateKeyBinding,
    resetKeyBinding,
  } = useSettings();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 py-4">
            <Link
              href="/dashboard"
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage your account and preferences
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar Navigation */}
          <div className="lg:col-span-1">
            <nav className="space-y-1">
              {navigationItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    item.active
                      ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </Link>
              ))}
            </nav>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <KeyBindings
              controls={settings.game.controls}
              onUpdateKey={updateKeyBinding}
              onResetKey={resetKeyBinding}
              onSave={saveSettings}
              isSaving={isSaving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}