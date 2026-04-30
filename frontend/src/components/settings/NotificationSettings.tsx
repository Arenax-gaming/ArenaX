"use client";

import React, { useState } from "react";
import { Bell, Mail, Smartphone, MessageSquare, Monitor, Check, Clock, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { NotificationPreference, NotificationChannel } from "@/types/settings";
import { notificationTypes, notificationChannels } from "@/data/settings";

interface NotificationSettingsProps {
  settings: NotificationPreference;
  onUpdate: (updates: Partial<NotificationPreference>) => void;
  onSave: () => Promise<boolean>;
  isSaving: boolean;
}

export function NotificationSettings({
  settings,
  onUpdate,
  onSave,
  isSaving,
}: NotificationSettingsProps) {
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const toggleNotification = (key: keyof NotificationPreference) => {
    onUpdate({ [key]: !settings[key as keyof NotificationPreference] } as Partial<NotificationPreference>);
  };

  const toggleChannel = (channel: NotificationChannel) => {
    const channels = settings.channels.includes(channel)
      ? settings.channels.filter((c) => c !== channel)
      : [...settings.channels, channel];
    onUpdate({ channels });
  };

  const isChannelEnabled = (channel: NotificationChannel) => {
    return settings.channels.includes(channel);
  };

  const getChannelIcon = (channel: NotificationChannel) => {
    switch (channel) {
      case "email":
        return <Mail className="h-4 w-4" />;
      case "push":
        return <Smartphone className="h-4 w-4" />;
      case "sms":
        return <MessageSquare className="h-4 w-4" />;
      case "in-app":
        return <Bell className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Notification Types */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Bell className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <CardTitle>Notification Types</CardTitle>
              <CardDescription>Choose which notifications you want to receive</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {notificationTypes.map((notification) => (
            <div
              key={notification.key}
              className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{notification.icon}</span>
                <div>
                  <p className="text-sm font-medium">{notification.label}</p>
                  <p className="text-xs text-muted-foreground">{notification.description}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings[notification.key as keyof NotificationPreference] as boolean}
                  onChange={() => toggleNotification(notification.key as keyof NotificationPreference)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Notification Channels */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Monitor className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <CardTitle>Notification Channels</CardTitle>
              <CardDescription>How you want to receive notifications</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {notificationChannels.map((channel) => {
            const channelValue = channel.value as NotificationChannel;
            return (
              <div
                key={channelValue}
                className={`flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
                  isChannelEnabled(channelValue)
                    ? "border-blue-500/50 bg-blue-500/5"
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      isChannelEnabled(channelValue) ? "bg-blue-500/20" : "bg-muted"
                    }`}
                  >
                    {getChannelIcon(channelValue)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{channel.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {isChannelEnabled(channelValue) ? "Enabled" : "Disabled"}
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isChannelEnabled(channelValue)}
                    onChange={() => toggleChannel(channelValue)}
                    className="sr-only peer"
                  />
                    <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <CardTitle>Quiet Hours</CardTitle>
              <CardDescription>Schedule do-not-disturb periods</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div>
              <p className="text-sm font-medium">Enable Quiet Hours</p>
              <p className="text-xs text-muted-foreground">
                Mute notifications during scheduled hours
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.quietHours.enabled}
                onChange={(e) =>
                  onUpdate({
                    quietHours: { ...settings.quietHours, enabled: e.target.checked },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.quietHours.enabled && (
            <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-muted">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Time</label>
                <input
                  type="time"
                  value={settings.quietHours.start}
                  onChange={(e) =>
                    onUpdate({
                      quietHours: { ...settings.quietHours, start: e.target.value },
                    })
                  }
                  className="w-full px-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Time</label>
                <input
                  type="time"
                  value={settings.quietHours.end}
                  onChange={(e) =>
                    onUpdate({
                      quietHours: { ...settings.quietHours, end: e.target.value },
                    })
                  }
                  className="w-full px-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-3">
        {saveSuccess && (
          <span className="text-sm text-green-500 flex items-center gap-1">
            <Check className="h-4 w-4" />
            Settings saved successfully
          </span>
        )}
        <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </div>
  );
}