import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useGameStore } from '@/stores/gameStore';

interface ChatOverlayProps {
  className?: string;
  maxMessages?: number;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({ 
  className = '',
  maxMessages = 50 
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [quickCommands, setQuickCommands] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const chatMessages = useGameStore((state) => state.chatMessages);
  const localPlayer = useGameStore((state) => state.localPlayer);
  const addChatMessage = useGameStore((state) => state.addChatMessage);
  const settings = useGameStore((state) => state.settings);
  const updateSettings = useGameStore((state) => state.updateSettings);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  const handleSendMessage = () => {
    if (!inputValue.trim() || !localPlayer) return;

    addChatMessage({
      playerId: localPlayer.id,
      playerName: localPlayer.name,
      message: inputValue.trim(),
      type: 'chat',
    });

    setInputValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickCommand = (command: string, message?: string) => {
    if (!localPlayer) return;

    const finalMessage = message || command;
    
    addChatMessage({
      playerId: localPlayer.id,
      playerName: localPlayer.name,
      message: finalMessage,
      type: command.startsWith('/') ? 'command' : 'chat',
    });

    setQuickCommands(false);
    setInputValue('');
  };

  const getMessageColor = (type: string) => {
    switch (type) {
      case 'system':
        return 'text-yellow-400';
      case 'command':
        return 'text-blue-400';
      default:
        return 'text-gray-300';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const quickCommandsList = [
    { command: '/help', message: 'Show available commands' },
    { command: '/stats', message: 'Show player statistics' },
    { command: '/score', message: 'Show current score' },
    { command: '/time', message: 'Show remaining time' },
    { command: '/gg', message: 'Good game!' },
    { command: '/nice', message: 'Nice play!' },
    { command: '/oops', message: 'My mistake!' },
    { command: '/brb', message: 'Be right back' },
  ];

  if (!settings.showChat) {
    return (
      <div className={`absolute bottom-4 right-4 ${className}`}>
        <button
          onClick={() => updateSettings({ showChat: true })}
          className="bg-black bg-opacity-70 text-gray-400 hover:text-white p-2 rounded-lg transition-colors"
          title="Show Chat"
        >
          <MessageSquare className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className={`absolute bottom-4 right-4 w-80 ${className}`}>
      {/* Chat Container */}
      <div className={`bg-black bg-opacity-80 rounded-lg border border-gray-700 transition-all duration-300 ${
        isMinimized ? 'h-10' : 'h-96'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-2 border-b border-gray-700">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-4 h-4 text-blue-500" />
            <span className="text-white font-bold text-sm">Chat</span>
            <span className="text-gray-400 text-xs">
              ({chatMessages.length})
            </span>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="text-gray-400 hover:text-white p-1 rounded transition-colors"
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <button
              onClick={() => updateSettings({ showChat: false })}
              className="text-gray-400 hover:text-white p-1 rounded transition-colors"
              title="Hide Chat"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Messages */}
        {!isMinimized && (
          <>
            <div className="h-64 overflow-y-auto p-2 space-y-1">
              {chatMessages.length === 0 ? (
                <div className="text-gray-500 text-center text-sm py-4">
                  No messages yet. Start a conversation!
                </div>
              ) : (
                chatMessages.slice(-maxMessages).map((msg) => (
                  <div key={msg.id} className="text-sm">
                    <div className="flex items-start space-x-2">
                      <span className="text-gray-500 text-xs">
                        {formatTimestamp(msg.timestamp)}
                      </span>
                      <span className={`font-semibold ${
                        msg.playerId === 'system' ? 'text-yellow-400' :
                        msg.playerId === localPlayer?.id ? 'text-green-400' :
                        'text-blue-400'
                      }`}>
                        {msg.playerName}:
                      </span>
                      <span className={getMessageColor(msg.type)}>
                        {msg.message}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-2 border-t border-gray-700">
              {/* Quick Commands */}
              {quickCommands && (
                <div className="mb-2 p-2 bg-gray-800 rounded max-h-32 overflow-y-auto">
                  <div className="text-xs text-gray-400 mb-1">Quick Commands:</div>
                  <div className="space-y-1">
                    {quickCommandsList.map(({ command, message }) => (
                      <button
                        key={command}
                        onClick={() => handleQuickCommand(command, message)}
                        className="block w-full text-left text-xs text-blue-400 hover:text-blue-300 hover:bg-gray-700 px-1 py-0.5 rounded transition-colors"
                      >
                        {command} - {message}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input Row */}
              <div className="flex items-center space-x-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  className="flex-1 bg-gray-800 text-white px-2 py-1 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => setQuickCommands(!quickCommands)}
                  className="text-gray-400 hover:text-white p-1 rounded transition-colors"
                  title="Quick Commands"
                >
                  <span className="text-xs font-bold">/</span>
                </button>
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim()}
                  className="text-blue-500 hover:text-blue-400 disabled:text-gray-600 p-1 rounded transition-colors"
                  title="Send Message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Chat Tips */}
      {!isMinimized && (
        <div className="mt-1 text-xs text-gray-500">
          Press Enter to send • Use / for commands • Press {settings.controls.chat.toUpperCase()} to toggle
        </div>
      )}
    </div>
  );
};
