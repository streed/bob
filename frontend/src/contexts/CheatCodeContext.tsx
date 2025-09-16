import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface CheatCodeContextType {
  isDatabaseUnlocked: boolean;
  unlockDatabase: () => void;
}

const CheatCodeContext = createContext<CheatCodeContextType | undefined>(undefined);

export const useCheatCode = () => {
  const context = useContext(CheatCodeContext);
  if (!context) {
    throw new Error('useCheatCode must be used within a CheatCodeProvider');
  }
  return context;
};

interface CheatCodeProviderProps {
  children: ReactNode;
}

export const CheatCodeProvider: React.FC<CheatCodeProviderProps> = ({ children }) => {
  const [isDatabaseUnlocked, setIsDatabaseUnlocked] = useState(false);
  const [keySequence, setKeySequence] = useState<string>('');

  const unlockDatabase = () => {
    setIsDatabaseUnlocked(true);
  };

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Don't capture keys when user is typing in input fields or in terminal/git areas
      const target = event.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || 
                          target.tagName === 'TEXTAREA' || 
                          target.contentEditable === 'true';
      
      const isInTerminalArea = target.closest('.right-panel') || 
                              target.closest('.terminal-content') ||
                              target.closest('.empty-terminal');

      if (isInputField || isInTerminalArea) {
        return;
      }

      const newSequence = (keySequence + event.key.toUpperCase()).slice(-5); // Keep only last 5 characters
      setKeySequence(newSequence);

      if (newSequence === 'IDDQD') {
        setIsDatabaseUnlocked(true);
        setKeySequence(''); // Reset sequence after successful unlock
        
        // Show a subtle notification
        const notification = document.createElement('div');
        notification.textContent = 'Database features unlocked';
        notification.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #2d5016;
          color: #e5e5e5;
          padding: 12px 16px;
          border-radius: 4px;
          border: 1px solid #4a8025;
          z-index: 9999;
          font-family: system-ui, -apple-system, sans-serif;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 3000);
      }
    };

    document.addEventListener('keypress', handleKeyPress);
    return () => {
      document.removeEventListener('keypress', handleKeyPress);
    };
  }, [keySequence]);

  return (
    <CheatCodeContext.Provider value={{ isDatabaseUnlocked, unlockDatabase }}>
      {children}
    </CheatCodeContext.Provider>
  );
};