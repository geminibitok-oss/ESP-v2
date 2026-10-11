import React, { useState } from 'react';
import { FIRMWARE_FILES } from '../data/firmwareSources';
import { SourceFile } from '../types';
import { 
  FileCode, 
  Download, 
  Copy, 
  Check, 
  FolderTree, 
  Cpu, 
  Layers, 
  Terminal, 
  BookOpen,
  Search
} from 'lucide-react';
import JSZip from 'jszip';

export const FirmwareExplorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<SourceFile>(FIRMWARE_FILES[0]);
  const [copied, setCopied] = useState<boolean>(false);
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredFiles = FIRMWARE_FILES.filter(
    (f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      const projectFolder = zip.folder('ESP_lestn_v2');
      const mainFolder = projectFolder?.folder('main');

      // Add all source files
      FIRMWARE_FILES.forEach((f) => {
        mainFolder?.file(f.name, f.code);
      });

      // Add root CMakeLists.txt
      projectFolder?.file(
        'CMakeLists.txt',
        `cmake_minimum_required(VERSION 3.16)\n\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(ESP_lestn_v2)\n`
      );

      // Add README.md
      projectFolder?.file(
        'README.md',
        `# ESP32 Smart Staircase Controller (v2.0)\n\n` +
        `Умный контроллер подсветки лестницы на микроконтроллере ESP32 и адресной ленте WS2812.\n\n` +
        `## Инструкция по прошивке через ESP-IDF\n\n` +
        `\`\`\`bash\n` +
        `# 1. Установите ESP-IDF v5.x\n` +
        `. $HOME/esp/esp-idf/export.sh\n\n` +
        `# 2. Перейдите в папку проекта\n` +
        `cd ESP_lestn_v2\n\n` +
        `# 3. Настройте цель (ESP32)\n` +
        `idf.py set-target esp32\n\n` +
        `# 4. Скомпилируйте и прошейте плату\n` +
        `idf.py build flash monitor\n` +
        `\`\`\`\n`
      );

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ESP_lestn_v2_clean_firmware.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate ZIP:', err);
    } finally {
      setDownloadingZip(false);
    }
  };

  const getCategoryBadge = (cat: SourceFile['category']) => {
    switch (cat) {
      case 'core':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950/80 text-sky-400 border border-sky-800/50">FSM / Ядро</span>;
      case 'driver':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/50">Драйвер железа</span>;
      case 'web':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">HTTP Сервер</span>;
      case 'config':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950/80 text-purple-400 border border-purple-800/50">Конфиг / NVS</span>;
    }
  };

  return (
    <div id="firmware-explorer" className="space-y-6">
      {/* Top Banner with Download Button */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              Исходный код прошивки ESP-IDF (v2.0)
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Все файлы оптимизированы: без блокировок в ISR, с мьютексами и AP fallback
            </p>
          </div>
        </div>

        <button
          id="download-zip-btn"
          onClick={handleDownloadZip}
          disabled={downloadingZip}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-all active:scale-95 disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          <span>{downloadingZip ? 'Формирование архива...' : 'Скачать проект целиком (.ZIP)'}</span>
        </button>
      </div>

      {/* Code Explorer Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: File Tree */}
        <div className="lg:col-span-4 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-zinc-500" />
            <input
              type="text"
              placeholder="Поиск по файлам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
            />
          </div>

          <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-2 pt-1 flex items-center gap-1.5">
            <FolderTree className="w-3.5 h-3.5 text-zinc-500" />
            <span>Файлы проекта (main/)</span>
          </div>

          <div className="space-y-1 overflow-y-auto max-h-[500px] pr-1">
            {filteredFiles.map((file) => {
              const isSelected = selectedFile.name === file.name;
              return (
                <button
                  key={file.name}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 transition-all ${
                    isSelected
                      ? 'bg-zinc-800 border border-zinc-700 text-white shadow-md'
                      : 'hover:bg-zinc-800/50 text-zinc-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileCode className={`w-4 h-4 shrink-0 ${isSelected ? 'text-sky-400' : 'text-zinc-500'}`} />
                    <span className="font-mono font-medium truncate">{file.name}</span>
                  </div>
                  {getCategoryBadge(file.category)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Pane: Code Viewer */}
        <div className="lg:col-span-8 bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
          {/* Header Bar */}
          <div className="bg-zinc-900/90 px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 truncate">
              <FileCode className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="font-mono text-xs text-zinc-200 font-semibold truncate">
                {selectedFile.path}
              </span>
            </div>

            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs flex items-center gap-1.5 transition-all"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>

          {/* Description */}
          <div className="px-4 py-2.5 bg-zinc-900/40 border-b border-zinc-800/80 text-xs text-zinc-400">
            {selectedFile.description}
          </div>

          {/* Code Text with Line Numbers */}
          <div className="overflow-auto max-h-[520px] p-4 text-xs font-mono bg-zinc-950 text-zinc-300 leading-relaxed">
            <pre className="grid grid-cols-[auto,1fr] gap-x-4">
              {selectedFile.code.split('\n').map((line, idx) => (
                <React.Fragment key={idx}>
                  <span className="text-zinc-600 select-none text-right pr-2">
                    {idx + 1}
                  </span>
                  <span className="whitespace-pre overflow-x-auto text-zinc-200">
                    {line}
                  </span>
                </React.Fragment>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
