import React, { useState } from 'react';
import { Settings, X, Save, RotateCcw, Volume2, Monitor, Gamepad2, Eye } from 'lucide-react';
import { useGameStore } from '@/stores/gameStore';

interface SettingsOverlayProps {
  className?: string;
  isOpen?: boolean;
  onClose?: () => void;
}

export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ 
  className = '',
  isOpen = false,
  onClose 
}) => {
  const [activeTab, setActiveTab] = useState<'controls' | 'audio' | 'graphics' | 'ui'>('controls');
  const [hasChanges, setHasChanges] = useState(false);
  const [tempSettings, setTempSettings] = useState(null);
  
  const settings = useGameStore((state) => state.settings);
  const updateSettings = useGameStore((state) => state.updateSettings);
  const resetSettings = useGameStore((state) => state.resetSettings);

  React.useEffect(() => {
    if (isOpen) {
      setTempSettings(JSON.parse(JSON.stringify(settings)));
      setHasChanges(false);
    }
  }, [isOpen, settings]);

  const handleUpdateTempSettings = (category: string, key: string, value: any) => {
    setTempSettings(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value
      }
    }));
    setHasChanges(true);
  };

  const handleSaveSettings = () => {
    if (tempSettings) {
      updateSettings(tempSettings);
      setHasChanges(false);
      onClose?.();
    }
  };

  const handleResetSettings = () => {
    resetSettings();
    setTempSettings(null);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setTempSettings(null);
    setHasChanges(false);
    onClose?.();
  };

  if (!isOpen) return null;

  const currentSettings = tempSettings || settings;

  const tabs = [
    { id: 'controls', label: 'Controls', icon: Gamepad2 },
    { id: 'audio', label: 'Audio', icon: Volume2 },
    { id: 'graphics', label: 'Graphics', icon: Monitor },
    { id: 'ui', label: 'UI', icon: Eye },
  ];

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 ${className}`}>
      <div className="bg-gray-900 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-blue-500" />
            <h2 className="text-white font-bold text-lg">Game Settings</h2>
          </div>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as any)}
              className={`flex items-center space-x-2 px-4 py-2 transition-colors ${
                activeTab === id 
                  ? 'bg-gray-800 text-blue-500 border-b-2 border-blue-500' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {/* Controls Tab */}
          {activeTab === 'controls' && (
            <div className="space-y-4">
              <h3 className="text-white font-semibold mb-3">Keyboard Controls</h3>
              {Object.entries(currentSettings.controls).map(([action, key]) => (
                <div key={action} className="flex items-center justify-between">
                  <label className="text-gray-300 capitalize">
                    {action.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => handleUpdateTempSettings('controls', action, e.target.value)}
                    className="bg-gray-800 text-white px-3 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none w-24 text-center"
                    maxLength={1}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Audio Tab */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <h3 className="text-white font-semibold mb-3">Audio Settings</h3>
              
              <div>
                <label className="text-gray-300 block mb-2">Master Volume</label>
                <div className="flex items-center space-x-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={currentSettings.masterVolume}
                    onChange={(e) => handleUpdateTempSettings('', 'masterVolume', parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-white w-12 text-right">{currentSettings.masterVolume}%</span>
                </div>
              </div>

              <div>
                <label className="text-gray-300 block mb-2">Sound Effects</label>
                <div className="flex items-center space-x-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={currentSettings.sfxVolume}
                    onChange={(e) => handleUpdateTempSettings('', 'sfxVolume', parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-white w-12 text-right">{currentSettings.sfxVolume}%</span>
                </div>
              </div>

              <div>
                <label className="text-gray-300 block mb-2">Music</label>
                <div className="flex items-center space-x-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={currentSettings.musicVolume}
                    onChange={(e) => handleUpdateTempSettings('', 'musicVolume', parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-white w-12 text-right">{currentSettings.musicVolume}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Graphics Tab */}
          {activeTab === 'graphics' && (
            <div className="space-y-4">
              <h3 className="text-white font-semibold mb-3">Graphics Settings</h3>
              
              <div>
                <label className="text-gray-300 block mb-2">Graphics Quality</label>
                <select
                  value={currentSettings.graphics}
                  onChange={(e) => handleUpdateTempSettings('', 'graphics', e.target.value)}
                  className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none w-full"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div className="bg-gray-800 p-3 rounded">
                <p className="text-gray-400 text-sm">
                  <strong>Low:</strong> Better performance, reduced visual quality<br/>
                  <strong>Medium:</strong> Balanced performance and quality<br/>
                  <strong>High:</strong> Best visual quality, requires more resources
                </p>
              </div>
            </div>
          )}

          {/* UI Tab */}
          {activeTab === 'ui' && (
            <div className="space-y-4">
              <h3 className="text-white font-semibold mb-3">Interface Settings</h3>
              
              <div className="space-y-3">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentSettings.showMinimap}
                    onChange={(e) => handleUpdateTempSettings('', 'showMinimap', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-gray-300">Show Minimap</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentSettings.showChat}
                    onChange={(e) => handleUpdateTempSettings('', 'showChat', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-gray-300">Show Chat</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentSettings.showFPS}
                    onChange={(e) => handleUpdateTempSettings('', 'showFPS', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-gray-300">Show FPS Counter</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <div className="text-sm text-gray-400">
            {hasChanges && <span className="text-yellow-400">Unsaved changes</span>}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleResetSettings}
              className="flex items-center space-x-1 bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
            <button
              onClick={handleCancel}
              className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={!hasChanges}
              className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1 rounded transition-colors"
            >
              <Save className="w-3 h-3" />
              <span>Save</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
