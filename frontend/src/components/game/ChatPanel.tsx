'use client';

export default function ChatPanel({ roomId }: { roomId: string }) {
  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 p-6">
      <h3 className="text-xl font-bold text-white mb-4">Chat</h3>
      <div className="h-64 overflow-y-auto mb-4 space-y-2">
        <p className="text-gray-400 text-sm">Chat messages will appear here...</p>
      </div>
      <input
        type="text"
        placeholder="Type a message..."
        className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-500"
      />
    </div>
  );
}
