import React, { useRef } from 'react';

interface DirectoryPickerProps {
  onDirectorySelect: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const DirectoryPicker: React.FC<DirectoryPickerProps> = ({
  onDirectorySelect,
  placeholder = "Select directory...",
  disabled = false
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDirectorySelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Get the path from the first file and extract directory path
      const file = files[0];
      // In the browser, we can get the relative path, but for full path we need the webkitRelativePath
      const fullPath = (file as any).webkitRelativePath || file.name;
      const directoryPath = fullPath.substring(0, fullPath.lastIndexOf('/')) || fullPath;
      
      // For local development, we'll use a more practical approach
      // The user will need to provide the full path manually or we use a different approach
      onDirectorySelect(directoryPath);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input
        ref={fileInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleDirectorySelect}
        disabled={disabled}
      />
      <button
        onClick={handleButtonClick}
        className="button secondary"
        disabled={disabled}
        style={{ whiteSpace: 'nowrap' }}
      >
        Browse...
      </button>
      <span style={{ fontSize: '14px', color: '#888', fontStyle: 'italic' }}>
        {placeholder}
      </span>
    </div>
  );
};