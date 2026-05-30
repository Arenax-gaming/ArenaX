"use client";

import React, { useState } from "react";
import { Users, Plus, Gamepad2 } from "lucide-react";
import { PartyManager } from "@/components/social/PartyManager";
import { useCreateParty, useFriendsList } from "@/hooks/useSocial";
import { useAuth } from "@/hooks/useAuth";

export default function PartyPage() {
  const { user } = useAuth();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [partyName, setPartyName] = useState("");
  const [partyDescription, setPartyDescription] = useState("");
  const [maxMembers, setMaxMembers] = useState(4);

  const { data: friendsData } = useFriendsList();
  const createPartyMutation = useCreateParty();

  const handleCreateParty = async () => {
    if (!partyName.trim()) return;

    try {
      await createPartyMutation.mutateAsync({
        name: partyName,
        description: partyDescription,
        maxMembers,
      });
      setPartyName("");
      setPartyDescription("");
      setMaxMembers(4);
      setShowCreateForm(false);
    } catch (error) {
      console.error("Failed to create party:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-2">
            <Users className="w-8 h-8" />
            Party System
          </h1>
          <p className="text-gray-400">
            Create or join a party to play with friends
          </p>
        </div>

        {/* Create Party Button */}
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="mb-8 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Create Party
        </button>

        {/* Create Party Form */}
        {showCreateForm && (
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">
              Create New Party
            </h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="party-name-create" className="block text-sm font-medium text-gray-300 mb-2">
                  Party Name
                </label>
                <input
                  id="party-name-create"
                  type="text"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  placeholder="Enter party name..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label htmlFor="party-description" className="block text-sm font-medium text-gray-300 mb-2">
                  Description (Optional)
                </label>
                <textarea
                  id="party-description"
                  value={partyDescription}
                  onChange={(e) => setPartyDescription(e.target.value)}
                  placeholder="Enter party description..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 h-20 resize-none"
                />
              </div>

              <div>
                <label htmlFor="max-members" className="block text-sm font-medium text-gray-300 mb-2">
                  Max Members: {maxMembers}
                </label>
                <input
                  id="max-members"
                  type="range"
                  min="2"
                  max="8"
                  value={maxMembers}
                  onChange={(e) => setMaxMembers(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="flex gap-4">
                <button
                  onClick={handleCreateParty}
                  disabled={createPartyMutation.isPending || !partyName.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  {createPartyMutation.isPending
                    ? "Creating..."
                    : "Create Party"}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Party Manager */}
        <PartyManager friends={friendsData?.friends || []} />
      </div>
    </div>
  );
}
