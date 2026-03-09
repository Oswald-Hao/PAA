import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Upload, Settings, MessageSquare, X, Send, Bot, User, MousePointer2, Highlighter, Pen, Eraser, ZoomIn, ZoomOut, Type, FileText, Wand2, Languages, AlignLeft, Check, Undo2, Download } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { Document, Page, pdfjs } from 'react-pdf';
import Markdown from 'react-markdown';
import { PDFDocument } from 'pdf-lib';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize pdfjs worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string;
  context?: string;
};

type AIConfig = {
  model: string;
  systemInstruction: string;
  temperature: number;
};

interface PageOverlayProps {
  tool: string;
  drawColor: string;
  drawSize: number;
  highlightColor: string;
  highlightSize: number;
  textColor: string;
  textSize: number;
  scale: number;
  pendingStampText: string | null;
  onStamp: () => void;
  onModified: () => void;
}

export interface PageOverlayRef {
  undo: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  getHistoryLength: () => number;
}

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const PageOverlay = forwardRef<PageOverlayRef, PageOverlayProps>(({ tool, drawColor, drawSize, highlightColor, highlightSize, textColor, textSize, scale, pendingStampText, onStamp, onModified }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  const [textPos, setTextPos] = useState<{x: number, y: number} | null>(null);
  const [textVal, setTextVal] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  useImperativeHandle(ref, () => ({
    undo: () => {
      setHistory(prev => {
        if (prev.length === 0) return prev;
        const newHistory = [...prev];
        const lastState = newHistory.pop();
        
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (canvas && context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
          if (newHistory.length > 0) {
            const img = new Image();
            img.src = newHistory[newHistory.length - 1];
            img.onload = () => {
              context.drawImage(img, 0, 0);
            };
          }
        }
        return newHistory;
      });
    },
    getCanvas: () => canvasRef.current,
    getHistoryLength: () => history.length
  }), [history]);

  const saveState = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      setHistory(prev => [...prev, canvas.toDataURL()]);
      onModified();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const updateCanvasSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      
      if (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight) {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        if (tempCtx && canvas.width > 0 && canvas.height > 0) {
            tempCtx.drawImage(canvas, 0, 0);
        }

        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        
        const context = canvas.getContext('2d');
        if (context) {
          context.lineCap = 'round';
          context.lineJoin = 'round';
          if (tempCanvas.width > 0 && tempCanvas.height > 0) {
              context.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, parent.clientWidth, parent.clientHeight);
          }
          setCtx(context);
        }
      }
    };

    setTimeout(updateCanvasSize, 100);

    const observer = new ResizeObserver(() => {
      updateCanvasSize();
    });
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [scale]);

  const commitText = () => {
    if (textPos && textVal.trim() && ctx) {
      saveState();
      ctx.font = `${textSize * scale}px sans-serif`;
      ctx.fillStyle = textColor;
      ctx.globalCompositeOperation = 'source-over';
      const lines = textVal.split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, textPos.x, textPos.y + ((i + 1) * (textSize * scale * 1.2)));
      });
    }
    setTextPos(null);
    setTextVal('');
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if ((tool === 'cursor' && !pendingStampText) || !ctx) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (pendingStampText) {
      saveState();
      ctx.font = `${textSize * scale}px sans-serif`;
      ctx.fillStyle = textColor;
      ctx.globalCompositeOperation = 'source-over';
      const lines = pendingStampText.split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, x, y + ((i + 1) * (textSize * scale * 1.2)));
      });
      onStamp();
      return;
    }

    if (tool === 'text') {
      if (textPos) {
        commitText();
      } else {
        setTextPos({ x, y });
        setTextVal('');
      }
      return;
    }

    saveState();
    setIsDrawing(true);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || tool === 'cursor' || tool === 'text' || pendingStampText || !ctx) return;
    if (e.cancelable) e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    if (tool === 'highlight') {
      ctx.strokeStyle = hexToRgba(highlightColor, 0.4);
      ctx.lineWidth = highlightSize * scale;
      ctx.globalCompositeOperation = 'source-over';
    } else if (tool === 'draw') {
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = drawSize * scale;
      ctx.globalCompositeOperation = 'source-over';
    } else if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 30 * scale;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    }

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing || !ctx) return;
    ctx.closePath();
    setIsDrawing(false);
  };

  return (
    <div className="absolute inset-0 z-10" style={{ pointerEvents: (tool === 'cursor' && !pendingStampText) ? 'none' : 'auto' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className={`absolute inset-0 touch-none ${pendingStampText ? 'cursor-crosshair' : ''}`}
      />
      {textPos && tool === 'text' && (
        <textarea
          autoFocus
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onBlur={commitText}
          placeholder="输入文字..."
          className="absolute z-20 bg-white/90 border-2 border-primary shadow-lg rounded-md p-2 outline-none resize-both text-zinc-900"
          style={{
            left: textPos.x,
            top: textPos.y,
            color: textColor,
            fontSize: `${textSize * scale}px`,
            minWidth: '200px',
            minHeight: '60px',
          }}
        />
      )}
    </div>
  );
});

export default function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [selectedText, setSelectedText] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('light');
  const [activeTab, setActiveTab] = useState<'chat' | 'write'>('chat');
  
  // Paper Writing State
  const [notepadContent, setNotepadContent] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);

  const [pendingStampText, setPendingStampText] = useState<string | null>(null);
  const [globalHistory, setGlobalHistory] = useState<number[]>([]);
  
  // PDF Tools State
  const [pdfTool, setPdfTool] = useState<'cursor' | 'draw' | 'highlight' | 'text' | 'eraser'>('cursor');
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [drawSize, setDrawSize] = useState(3);
  const [highlightColor, setHighlightColor] = useState('#facc15');
  const [highlightSize, setHighlightSize] = useState(24);
  const [textColor, setTextColor] = useState('#000000');
  const [textSize, setTextSize] = useState(16);
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    model: 'gemini-3-flash-preview',
    systemInstruction: '你是一个专业的学术助手。请用中文回答用户的问题，帮助用户阅读、理解和撰写论文。如果你需要帮用户起草内容，请提供结构清晰的文本，以便用户插入到笔记或PDF中。',
    temperature: 0.7,
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const pageRefs = useRef<Record<number, PageOverlayRef>>({});

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim() !== '') {
        if (pdfContainerRef.current && pdfContainerRef.current.contains(selection.anchorNode)) {
          setSelectedText(selection.toString().trim());
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setMessages([]);
      setSelectedText('');
      setScale(1.0);
      setGlobalHistory([]);
      pageRefs.current = {};

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPdfBase64(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleExport = async () => {
    if (!pdfBase64) return;
    setIsExporting(true);
    try {
      const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();
      
      for (let i = 0; i < numPages; i++) {
        const overlay = pageRefs.current[i];
        if (overlay && overlay.getHistoryLength() > 0) {
          const canvas = overlay.getCanvas();
          if (canvas) {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl.length > 1000) {
              const pngImage = await pdfDoc.embedPng(dataUrl);
              const page = pages[i];
              page.drawImage(pngImage, {
                x: 0,
                y: 0,
                width: page.getWidth(),
                height: page.getHeight(),
              });
            }
          }
        }
      }
      
      const savedPdfBytes = await pdfDoc.save();
      const blob = new Blob([savedPdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotated_paper.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('导出 PDF 失败，请重试。');
    } finally {
      setIsExporting(false);
    }
  };

  const sendPrompt = async (promptText: string, contextText: string = '') => {
    if (!promptText.trim() && !contextText) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: promptText,
      context: contextText,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setActiveTab('chat');

    const aiMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: aiMessageId, role: 'ai', content: '' }]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const parts: any[] = [];
      
      if (pdfBase64) {
        parts.push({
          inlineData: {
            data: pdfBase64,
            mimeType: 'application/pdf'
          }
        });
      }

      let fullPrompt = `我附上了一份完整的 PDF 文档。请仔细阅读全文来回答我的问题。\n\n`;
      if (userMessage.context) {
        fullPrompt += `我还选中了文档中的这段话，请重点关注：\n"""\n${userMessage.context}\n"""\n\n`;
      }
      fullPrompt += `我的问题/要求：${userMessage.content}`;
      
      parts.push({ text: fullPrompt });

      const responseStream = await ai.models.generateContentStream({
        model: aiConfig.model,
        contents: { parts },
        config: {
          systemInstruction: aiConfig.systemInstruction,
          temperature: aiConfig.temperature,
        },
      });

      let fullText = '';
      for await (const chunk of responseStream) {
        fullText += chunk.text;
        setMessages((prev) => 
          prev.map(msg => msg.id === aiMessageId ? { ...msg, content: fullText } : msg)
        );
      }
    } catch (error) {
      console.error('Error generating AI response:', error);
      setMessages((prev) => 
        prev.map(msg => msg.id === aiMessageId ? { ...msg, content: '抱歉，与 AI 通信时发生错误。请检查您的 API 密钥并重试。' } : msg)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const generateDraft = async () => {
    if (!draftPrompt.trim()) return;
    setIsDrafting(true);
    setAiDraft('');
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const parts: any[] = [];
      
      if (pdfBase64) {
        parts.push({
          inlineData: {
            data: pdfBase64,
            mimeType: 'application/pdf'
          }
        });
      }
      
      parts.push({ text: `你是一个专业的论文写作助手。请根据以下要求，为我起草一段论文内容。请直接输出正文，不要包含多余的寒暄。\n\n写作要求：${draftPrompt}` });
      
      const responseStream = await ai.models.generateContentStream({
        model: aiConfig.model,
        contents: { parts },
        config: {
          systemInstruction: aiConfig.systemInstruction,
          temperature: aiConfig.temperature,
        },
      });

      let fullText = '';
      for await (const chunk of responseStream) {
        fullText += chunk.text;
        setAiDraft(fullText);
      }
    } catch (error) {
      console.error('Drafting error:', error);
      setAiDraft('抱歉，生成草稿时发生错误，请重试。');
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSendMessage = () => {
    sendPrompt(input, selectedText);
  };

  const handleQuickAction = (action: string) => {
    let prompt = '';
    switch (action) {
      case 'explain': prompt = '请用通俗易懂的中文解释这段内容：'; break;
      case 'summarize': prompt = '请用中文对这段内容进行简明扼要的总结：'; break;
      case 'translate': prompt = '请将这段内容准确地翻译成中文：'; break;
      case 'expand': prompt = '请根据这段内容，用中文进行详细的扩写和延伸：'; break;
    }
    sendPrompt(prompt, selectedText);
  };

  const handleUndo = () => {
    setGlobalHistory(prev => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const pageIndex = newHistory.pop()!;
      pageRefs.current[pageIndex]?.undo();
      return newHistory;
    });
  };

  const ToolButton = ({ icon, label, active, onClick, disabled }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-2.5 rounded-xl transition-all flex items-center justify-center ${disabled ? 'opacity-50 cursor-not-allowed text-muted' : active ? 'bg-primary text-white shadow-md' : 'text-muted hover:bg-secondary hover:text-content'}`}
      title={label}
    >
      {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
    </button>
  );

  return (
    <div data-theme={theme} className="flex h-screen w-full bg-background text-content font-sans overflow-hidden transition-colors duration-200">
      {/* Left Panel: PDF Viewer */}
      <div className="flex-1 flex flex-col border-r border-border-subtle bg-panel relative transition-colors duration-200">
        <div className="h-14 border-b border-border-subtle flex items-center justify-between px-4 bg-panel z-10 transition-colors duration-200">
          <h1 className="font-semibold text-lg flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            PDF AI Chat & Draft
          </h1>
          
          {pdfFile && (
            <div className="flex items-center gap-2 bg-secondary rounded-lg p-1">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className="p-1.5 hover:bg-panel rounded-md text-muted hover:text-content transition-colors" title="Zoom Out">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-medium w-12 text-center text-content">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(3.0, s + 0.1))} className="p-1.5 hover:bg-panel rounded-md text-muted hover:text-content transition-colors" title="Zoom In">
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {pdfFile && (
              <button 
                onClick={handleExport} 
                disabled={isExporting} 
                className="bg-secondary hover:bg-secondary/80 text-content px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 mr-2"
              >
                {isExporting ? <div className="w-4 h-4 border-2 border-content border-t-transparent rounded-full animate-spin"></div> : <Download className="w-4 h-4" />}
                导出 PDF
              </button>
            )}
            <label className="cursor-pointer bg-primary text-white hover:bg-primary-hover px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2">
              <Upload className="w-4 h-4" />
              上传 PDF
              <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        </div>

        {pendingStampText && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-primary text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-pulse">
            <MousePointer2 className="w-4 h-4" />
            <span className="text-sm font-medium">在 PDF 任意位置点击即可插入文字</span>
            <button onClick={() => setPendingStampText(null)} className="ml-2 hover:bg-white/20 rounded-full p-1">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-background relative" ref={pdfContainerRef}>
          {!pdfFile ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted">
              <Upload className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">未加载 PDF</p>
              <p className="text-sm">上传 PDF 文件以开始阅读、写作和对话</p>
            </div>
          ) : (
            <div className="flex justify-center p-4 pb-32">
              <Document
                file={pdfFile}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                className="flex flex-col gap-4"
                loading={
                  <div className="flex items-center justify-center p-12 text-muted">
                    加载 PDF 中...
                  </div>
                }
              >
                {Array.from(new Array(numPages), (el, index) => (
                  <div key={`page_${index + 1}`} className="relative bg-panel shadow-sm rounded-sm overflow-hidden" style={{ width: `${800 * scale}px` }}>
                    <Page
                      pageNumber={index + 1}
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                      className="max-w-full"
                      width={800}
                      scale={scale}
                    />
                    <PageOverlay 
                      ref={(el) => { if (el) pageRefs.current[index] = el; }}
                      tool={pdfTool} 
                      drawColor={drawColor}
                      drawSize={drawSize}
                      highlightColor={highlightColor}
                      highlightSize={highlightSize}
                      textColor={textColor}
                      textSize={textSize}
                      scale={scale}
                      pendingStampText={pendingStampText}
                      onStamp={() => setPendingStampText(null)}
                      onModified={() => setGlobalHistory(prev => [...prev, index])}
                    />
                  </div>
                ))}
              </Document>
            </div>
          )}
          
          {/* PDF Toolbar */}
          {pdfFile && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-panel border border-border-subtle shadow-2xl rounded-2xl flex flex-col overflow-hidden z-20 transition-colors duration-200">
              {/* Tool Options */}
              {pdfTool !== 'cursor' && pdfTool !== 'eraser' && (
                <div className="flex items-center justify-between gap-6 px-4 py-3 bg-secondary/50 border-b border-border-subtle">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-muted uppercase tracking-wider">大小</span>
                    <input
                      type="range"
                      min={pdfTool === 'highlight' ? 10 : 1}
                      max={pdfTool === 'highlight' ? 50 : 30}
                      value={pdfTool === 'draw' ? drawSize : pdfTool === 'highlight' ? highlightSize : textSize}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (pdfTool === 'draw') setDrawSize(val);
                        else if (pdfTool === 'highlight') setHighlightSize(val);
                        else setTextSize(val);
                      }}
                      className="w-24 accent-primary"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-muted uppercase tracking-wider">颜色</span>
                    <input
                      type="color"
                      value={pdfTool === 'draw' ? drawColor : pdfTool === 'highlight' ? highlightColor : textColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (pdfTool === 'draw') setDrawColor(val);
                        else if (pdfTool === 'highlight') setHighlightColor(val);
                        else setTextColor(val);
                      }}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                    />
                  </div>
                </div>
              )}

              {/* Tools */}
              <div className="flex items-center gap-1 p-2">
                <ToolButton icon={<MousePointer2 />} label="选择文本" active={pdfTool === 'cursor'} onClick={() => setPdfTool('cursor')} />
                <div className="w-px h-6 bg-border-subtle mx-1"></div>
                <ToolButton icon={<Highlighter />} label="高亮" active={pdfTool === 'highlight'} onClick={() => setPdfTool('highlight')} />
                <ToolButton icon={<Pen />} label="画笔" active={pdfTool === 'draw'} onClick={() => setPdfTool('draw')} />
                <ToolButton icon={<Type />} label="文本笔记" active={pdfTool === 'text'} onClick={() => setPdfTool('text')} />
                <div className="w-px h-6 bg-border-subtle mx-1"></div>
                <ToolButton icon={<Eraser />} label="橡皮擦" active={pdfTool === 'eraser'} onClick={() => setPdfTool('eraser')} />
                <div className="w-px h-6 bg-border-subtle mx-1"></div>
                <ToolButton icon={<Undo2 />} label="撤销" active={false} onClick={handleUndo} disabled={globalHistory.length === 0} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Chat & Notepad Interface */}
      <div className="w-[400px] flex flex-col bg-panel shadow-[-4px_0_24px_rgba(0,0,0,0.02)] z-20 transition-colors duration-200">
        <div className="h-14 border-b border-border-subtle flex items-center justify-between px-2">
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setActiveTab('chat')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'chat' ? 'bg-secondary text-content' : 'text-muted hover:text-content hover:bg-secondary/50'}`}
            >
              <Bot className="w-4 h-4" />
              {aiConfig.model.includes('flash') ? 'Flash' : 'Pro'}
            </button>
            <button 
              onClick={() => setActiveTab('write')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'write' ? 'bg-secondary text-content' : 'text-muted hover:text-content hover:bg-secondary/50'}`}
            >
              <FileText className="w-4 h-4" />
              论文写作
            </button>
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-muted hover:text-content hover:bg-secondary rounded-lg transition-colors"
            title="AI Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {activeTab === 'write' ? (
          <div className="flex-1 flex flex-col p-4 overflow-y-auto">
            <div className="mb-2 text-sm text-muted flex items-center gap-2">
              <Pen className="w-4 h-4" />
              论文草稿区
            </div>
            <textarea
              value={notepadContent}
              onChange={(e) => setNotepadContent(e.target.value)}
              placeholder="在这里撰写您的论文或笔记..."
              className="flex-1 w-full min-h-[300px] bg-secondary/50 border border-border-subtle rounded-xl p-4 text-content resize-none outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            
            {/* AI Drafting Section */}
            <div className="mt-4 border border-border-subtle rounded-xl bg-secondary/30 p-3 flex flex-col gap-2">
               <div className="text-xs font-medium text-primary flex items-center gap-1"><Wand2 className="w-3 h-3"/> AI 辅助写作</div>
               {aiDraft ? (
                  <div className="bg-background border border-primary/20 rounded-lg p-3 text-sm relative">
                     <div className="prose prose-sm max-w-none prose-zinc dark:prose-invert">
                       <Markdown>{aiDraft}</Markdown>
                     </div>
                     {!isDrafting && (
                       <div className="flex gap-2 mt-3 justify-end">
                          <button onClick={() => { setNotepadContent(prev => prev + (prev ? '\n\n' : '') + aiDraft); setAiDraft(''); }} className="text-xs bg-primary text-white px-3 py-1.5 rounded-md flex items-center gap-1 hover:bg-primary-hover transition-colors"><Check className="w-3 h-3"/> 采纳并插入</button>
                          <button onClick={() => setAiDraft('')} className="text-xs bg-secondary text-content px-3 py-1.5 rounded-md flex items-center gap-1 hover:bg-secondary/80 transition-colors"><X className="w-3 h-3"/> 丢弃</button>
                       </div>
                     )}
                     {isDrafting && (
                        <div className="flex items-center gap-1 mt-2 text-muted">
                          <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"></div>
                        </div>
                     )}
                  </div>
               ) : (
                  <div className="flex gap-2">
                     <input 
                       value={draftPrompt} 
                       onChange={e => setDraftPrompt(e.target.value)} 
                       onKeyDown={(e) => { if (e.key === 'Enter') generateDraft(); }}
                       placeholder="输入写作要求，例如：帮我写一段引言..." 
                       className="flex-1 text-sm bg-background border border-border-subtle rounded-lg px-3 py-2 outline-none focus:border-primary text-content placeholder:text-muted" 
                     />
                     <button 
                       onClick={generateDraft} 
                       disabled={!draftPrompt.trim() || isDrafting} 
                       className="bg-primary hover:bg-primary-hover text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
                     >
                       <Send className="w-4 h-4"/>
                     </button>
                  </div>
               )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted space-y-3">
                  <Bot className="w-10 h-10 opacity-50" />
                  <p className="text-sm px-6">
                    我可以帮您阅读和写作。选中左侧文本进行分析，或者直接向我提问！
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-start gap-2 max-w-[95%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted'}`}>
                        {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                      </div>
                      <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'} w-full`}>
                        {msg.context && (
                          <div className="bg-primary/5 border border-primary/20 text-content text-xs p-2 rounded-md max-w-full overflow-hidden text-ellipsis line-clamp-3">
                            <span className="font-semibold block mb-1 text-primary">选中文本:</span>
                            "{msg.context}"
                          </div>
                        )}
                        <div className={`px-4 py-3 rounded-2xl text-sm w-full ${
                          msg.role === 'user'
                            ? 'bg-primary text-white rounded-tr-sm'
                            : 'bg-secondary text-content rounded-tl-sm'
                        }`}>
                          {msg.role === 'ai' ? (
                            <div className="prose prose-sm max-w-none prose-zinc dark:prose-invert">
                              <Markdown>{msg.content}</Markdown>
                            </div>
                          ) : (
                            msg.content
                          )}
                        </div>
                        {msg.role === 'ai' && msg.content && !isLoading && (
                          <div className="flex items-center gap-2 mt-1 ml-1">
                            <button 
                              onClick={() => setPendingStampText(msg.content)}
                              className="text-xs flex items-center gap-1 text-muted hover:text-primary transition-colors bg-background px-2 py-1 rounded-md border border-border-subtle hover:border-primary/30"
                            >
                              <MousePointer2 className="w-3 h-3" /> 印在 PDF 上
                            </button>
                            <button 
                              onClick={() => {
                                setNotepadContent(prev => prev + (prev ? '\n\n' : '') + msg.content);
                                setActiveTab('write');
                              }}
                              className="text-xs flex items-center gap-1 text-muted hover:text-primary transition-colors bg-background px-2 py-1 rounded-md border border-border-subtle hover:border-primary/30"
                            >
                              <FileText className="w-3 h-3" /> 加入论文草稿
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-secondary text-muted flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-secondary text-content px-4 py-3 rounded-2xl rounded-tl-sm text-sm flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 bg-panel border-t border-border-subtle transition-colors duration-200">
              {selectedText && (
                <div className="mb-3">
                  <div className="flex items-start justify-between bg-primary/5 border border-primary/20 rounded-md p-2 mb-2">
                    <div className="text-xs text-content line-clamp-2 pr-2">
                      <span className="font-semibold text-primary">已选择: </span>
                      "{selectedText}"
                    </div>
                    <button
                      onClick={() => setSelectedText('')}
                      className="text-muted hover:text-content shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleQuickAction('explain')} className="text-xs flex items-center gap-1 bg-secondary hover:bg-primary/10 hover:text-primary text-content px-2.5 py-1.5 rounded-md transition-colors border border-border-subtle">
                      <Wand2 className="w-3 h-3" /> 解释
                    </button>
                    <button onClick={() => handleQuickAction('summarize')} className="text-xs flex items-center gap-1 bg-secondary hover:bg-primary/10 hover:text-primary text-content px-2.5 py-1.5 rounded-md transition-colors border border-border-subtle">
                      <AlignLeft className="w-3 h-3" /> 总结
                    </button>
                    <button onClick={() => handleQuickAction('translate')} className="text-xs flex items-center gap-1 bg-secondary hover:bg-primary/10 hover:text-primary text-content px-2.5 py-1.5 rounded-md transition-colors border border-border-subtle">
                      <Languages className="w-3 h-3" /> 翻译
                    </button>
                    <button onClick={() => handleQuickAction('expand')} className="text-xs flex items-center gap-1 bg-secondary hover:bg-primary/10 hover:text-primary text-content px-2.5 py-1.5 rounded-md transition-colors border border-border-subtle">
                      <Pen className="w-3 h-3" /> 扩写
                    </button>
                  </div>
                </div>
              )}
              <div className="relative flex items-center">
                <textarea
                  ref={chatInputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="输入您的问题..."
                  className="w-full bg-secondary border-transparent focus:bg-panel focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-xl pl-4 pr-12 py-3 text-sm resize-none outline-none transition-all text-content placeholder:text-muted"
                  rows={1}
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={(!input.trim() && !selectedText) || isLoading}
                  className="absolute right-2 p-1.5 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:hover:bg-primary transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-panel text-content rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-border-subtle">
            <div className="flex items-center justify-between p-4 border-b border-border-subtle">
              <h3 className="font-semibold text-lg">配置</h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-muted hover:text-content"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">UI 主题</label>
                <div className="flex gap-2">
                  {(['light', 'dark', 'sepia'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`px-4 py-2 rounded-md text-sm capitalize border transition-colors ${theme === t ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border-subtle text-muted hover:bg-secondary'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-px w-full bg-border-subtle"></div>
              <div>
                <label className="block text-sm font-medium mb-1">AI 模型</label>
                <select
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                  className="w-full border border-border-subtle bg-secondary text-content rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">系统提示词 (System Instruction)</label>
                <textarea
                  value={aiConfig.systemInstruction}
                  onChange={(e) => setAiConfig({ ...aiConfig, systemInstruction: e.target.value })}
                  className="w-full border border-border-subtle bg-secondary text-content rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 h-24 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  随机性 (Temperature): {aiConfig.temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={aiConfig.temperature}
                  onChange={(e) => setAiConfig({ ...aiConfig, temperature: parseFloat(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>
            </div>
            <div className="p-4 border-t border-border-subtle bg-secondary/50 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="bg-primary text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-primary-hover transition-colors"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
