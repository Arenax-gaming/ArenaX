"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Gamepad2,
  Bell,
  Lock,
  Accessibility,
  Palette,
  Keyboard,
  Save,
} from "lucide-react";
import { SettingsBackup } from "@/components/settings/SettingsBackup";

const navigationItems = [
  {
    href: "/settings/account",
    label: "Account",
    description: "Email, password, and security",
    icon: User,
  },
  {
    href: "/settings/game",
    label: "Game",
    description: "Graphics, audio, and gameplay",
    icon: Gamepad2,
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    description: "Alerts and communication",
    icon: Bell,
  },
  {
    href: "/settings/privacy",
    label: "Privacy",
    description: "Data and visibility controls",
    icon: Lock,
  },
  {
    href: "/settings/accessibility",
    label: "Accessibility",
    description: "Inclusive design features",
    icon: Accessibility,
  },
  {
    href: "/settings/theme",
    label: "Theme",
    description: "Visual customization",
    icon: Palette,
  },
  {
    href: "/settings/keybindings",
    label: "Key Bindings",
    description: "Control customization",
    icon: Keyboard,
  },
];

export default function SettingsPage() {
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
                  className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted text-foreground transition-colors"
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
          <div className="lg:col-span-3 space-y-8">
            <div>
              <h2 className="mb-4 text-lg font-bold text-foreground">
                Getting Started
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {navigationItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-xl border bg-card p-4 hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-primary">
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {item.description}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-card p-6">
              <div className="flex items-center gap-2 mb-2">
                <Save className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-bold text-foreground">
                  Backup &amp; Restore
                </h3>
              </div>
              <SettingsBackup />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}