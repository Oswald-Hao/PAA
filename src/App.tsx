import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Upload, Settings, MessageSquare, X, Send, Bot, User, MousePointer2, Highlighter, Pen, Eraser, ZoomIn, ZoomOut, Type, FileText, Wand2, Languages, AlignLeft, Check, Undo2, Download, Sparkles, FilePlus2, BarChart3, ChevronRight, Edit3, PanelRightClose, PanelRightOpen, Copy, Pipette, Hand } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { Document, Page, pdfjs } from 'react-pdf';
import Markdown from 'react-markdown';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
  chartData?: any;
};

type AIProvider = 'gemini' | 'zhipu';

type AIConfig = {
  provider: AIProvider;
  model: string;
  apiKey: string;
  systemInstruction: string;
  temperature: number;
};

interface PageOverlayProps {
  tool: string;
  drawColor: string;
  drawSize: number;
  highlightColor: string;
  highlightSize: number;
  eraserSize: number;
  textColor: string;
  textSize: number;
  replaceBgColor: string;
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

const PageOverlay = forwardRef<PageOverlayRef, PageOverlayProps>(({ tool, drawColor, drawSize, highlightColor, highlightSize, eraserSize, textColor, textSize, replaceBgColor, scale, pendingStampText, onStamp, onModified }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  const [textPos, setTextPos] = useState<{x: number, y: number, width?: number, height?: number, isReplace?: boolean} | null>(null);
  const [textVal, setTextVal] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [replaceStart, setReplaceStart] = useState<{x: number, y: number} | null>(null);
  const [replaceCurrent, setReplaceCurrent] = useState<{x: number, y: number} | null>(null);
  const isCanceling = useRef(false);

  const doUndo = () => {
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
  };

  useImperativeHandle(ref, () => ({
    undo: doUndo,
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

  const wrapText = (context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    const paragraphs = text.split('\n');
    let currentY = y;

    paragraphs.forEach(paragraph => {
      let line = '';
      
      for (let n = 0; n < paragraph.length; n++) {
        const char = paragraph[n];
        const testLine = line + char;
        const metrics = context.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && n > 0) {
          context.fillText(line, x, currentY);
          line = char;
          currentY += lineHeight;
        } else {
          line = testLine;
        }
      }
      context.fillText(line, x, currentY);
      currentY += lineHeight;
    });
  };

  const commitText = () => {
    if (isCanceling.current) return;
    if (textPos && textVal.trim() && ctx) {
      if (!textPos.isReplace) saveState();
      ctx.font = `${textSize * scale}px sans-serif`;
      ctx.fillStyle = textColor;
      ctx.globalCompositeOperation = 'source-over';
      
      const maxWidth = textPos.width || ((canvasRef.current?.width || 800) - textPos.x - 20);
      const lineHeight = textSize * scale * 1.5;
      
      const paddingX = textPos.isReplace ? 2 : 8;
      const paddingY = textPos.isReplace ? 2 : 8;
      
      wrapText(ctx, textVal, textPos.x + paddingX, textPos.y + (textSize * scale) + paddingY, maxWidth - paddingX * 2, lineHeight);
    }
    setTextPos(null);
    setTextVal('');
  };

  const cancelText = () => {
    isCanceling.current = true;
    if (textPos?.isReplace) {
      doUndo();
    }
    setTextPos(null);
    setTextVal('');
    setTimeout(() => { isCanceling.current = false; }, 100);
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if ((tool === 'cursor' && !pendingStampText) || tool === 'pan' || !ctx) return;
    
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
      
      const maxWidth = canvas.width - x - 20;
      const lineHeight = textSize * scale * 1.5;
      
      wrapText(ctx, pendingStampText, x, y + (textSize * scale), maxWidth, lineHeight);
      onStamp();
      return;
    }

    if (tool === 'replace') {
      setReplaceStart({ x, y });
      setReplaceCurrent({ x, y });
      return;
    }

    if (tool === 'text') {
      if (textPos) {
        setTimeout(() => {
          setTextPos({ x, y });
          setTextVal('');
        }, 50);
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (tool === 'replace' && replaceStart) {
      setReplaceCurrent({ x, y });
      return;
    }

    if (!isDrawing || tool === 'cursor' || tool === 'pan' || tool === 'text' || tool === 'replace' || pendingStampText || !ctx) return;
    if (e.cancelable) e.preventDefault();

    if (tool === 'highlight') {
      ctx.strokeStyle = hexToRgba(highlightColor, 0.4);
      ctx.lineWidth = highlightSize * scale;
      ctx.globalCompositeOperation = 'multiply';
    } else if (tool === 'draw') {
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = drawSize * scale;
      ctx.globalCompositeOperation = 'source-over';
    } else if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = eraserSize * scale;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    }

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (tool === 'replace' && replaceStart && replaceCurrent && ctx) {
      const rx = Math.min(replaceStart.x, replaceCurrent.x);
      const ry = Math.min(replaceStart.y, replaceCurrent.y);
      const rw = Math.abs(replaceCurrent.x - replaceStart.x);
      const rh = Math.abs(replaceCurrent.y - replaceStart.y);
      
      if (rw > 5 && rh > 5) {
        saveState();
        ctx.fillStyle = replaceBgColor;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillRect(rx, ry, rw, rh);
        
        setTextPos({ x: rx, y: ry, width: rw, height: rh, isReplace: true });
        setTextVal('');
      }
      setReplaceStart(null);
      setReplaceCurrent(null);
      return;
    }

    if (!isDrawing || !ctx) return;
    ctx.closePath();
    setIsDrawing(false);
  };

  return (
    <div className="absolute inset-0 z-10" style={{ pointerEvents: ((tool === 'cursor' || tool === 'pan') && !pendingStampText) ? 'none' : 'auto' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className={`absolute inset-0 touch-none ${pendingStampText ? 'cursor-crosshair' : tool === 'text' ? 'cursor-text' : tool === 'replace' ? 'cursor-crosshair' : ''}`}
      />
      {replaceStart && replaceCurrent && tool === 'replace' && (
        <div
          className="absolute border-2 border-orange-500 bg-white/50 z-20 pointer-events-none"
          style={{
            left: Math.min(replaceStart.x, replaceCurrent.x),
            top: Math.min(replaceStart.y, replaceCurrent.y),
            width: Math.abs(replaceCurrent.x - replaceStart.x),
            height: Math.abs(replaceCurrent.y - replaceStart.y),
          }}
        />
      )}
      {textPos && (tool === 'text' || tool === 'replace') && (
        <textarea
          autoFocus
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelText();
            }
          }}
          placeholder={textPos.isReplace ? "输入替换文字 (Esc 取消)..." : "输入文字 (Esc 取消)..."}
          className={`absolute z-20 outline-none resize-none text-zinc-900 ${textPos.isReplace ? 'bg-transparent overflow-hidden' : 'bg-white/90 border-2 border-primary shadow-[0_0_15px_rgba(var(--color-primary),0.5)] rounded-md p-2 backdrop-blur-sm'}`}
          style={{
            left: textPos.x,
            top: textPos.y,
            width: textPos.width ? `${textPos.width}px` : 'auto',
            height: textPos.height ? `${textPos.height}px` : 'auto',
            minWidth: textPos.width ? undefined : '200px',
            minHeight: textPos.height ? undefined : '60px',
            color: textColor,
            fontSize: `${textSize * scale}px`,
            lineHeight: 1.5,
            padding: textPos.isReplace ? '2px' : undefined,
          }}
        />
      )}
    </div>
  );
});

// Chart Component
const DynamicChart = ({ data, type }: { data: any, type: string }) => {
  if (!data || !data.length) return null;
  
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];
  
  return (
    <div className="h-64 w-full mt-4 bg-background/50 rounded-xl p-4 border border-border-subtle backdrop-blur-sm">
      <ResponsiveContainer width="100%" height="100%">
        {type === 'bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" stroke="#888" />
            <YAxis stroke="#888" />
            <Tooltip contentStyle={{ backgroundColor: 'var(--color-panel)', borderColor: 'var(--color-border-subtle)', borderRadius: '8px' }} />
            <Legend />
            <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
              {data.map((entry: any, index: number) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: 'var(--color-panel)', borderColor: 'var(--color-border-subtle)', borderRadius: '8px' }} />
            <Legend />
          </PieChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" stroke="#888" />
            <YAxis stroke="#888" />
            <Tooltip contentStyle={{ backgroundColor: 'var(--color-panel)', borderColor: 'var(--color-border-subtle)', borderRadius: '8px' }} />
            <Legend />
            <Line type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
};

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
  
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('dark');
  const [mode, setMode] = useState<'read' | 'create'>('read');
  
  const [pendingStampText, setPendingStampText] = useState<string | null>(null);
  const [globalHistory, setGlobalHistory] = useState<number[]>([]);
  
  // PDF Tools State
  const [pdfTool, setPdfTool] = useState<'cursor' | 'pan' | 'draw' | 'highlight' | 'text' | 'eraser' | 'replace'>('cursor');
  const [drawColor, setDrawColor] = useState('#00f0ff');
  const [drawSize, setDrawSize] = useState(3);
  const [highlightColor, setHighlightColor] = useState('#ff003c');
  const [highlightSize, setHighlightSize] = useState(24);
  const [eraserSize, setEraserSize] = useState(30);
  const [textColor, setTextColor] = useState('#000000');
  const [textSize, setTextSize] = useState(16);
  const [replaceBgColor, setReplaceBgColor] = useState('#ffffff');
  
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    provider: 'gemini',
    model: 'gemini-3.1-pro-preview',
    apiKey: '',
    systemInstruction: '你是一个顶级的学术助手和论文写手。请用中文回答。你可以帮用户阅读论文，也可以帮用户从零开始创作论文。如果用户需要数据可视化，请返回一个 JSON 格式的图表数据，格式为：```json\n{"chartType": "bar|line|pie", "data": [{"name": "A", "value": 10}]}\n```。',
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
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim() !== '') {
        if (pdfContainerRef.current && pdfContainerRef.current.contains(selection.anchorNode)) {
          setSelectedText(selection.toString().trim());
          try {
             const range = selection.getRangeAt(0);
             const rect = range.getBoundingClientRect();
             setSelectionRect(rect);
          } catch(e) {}
        }
      } else {
        // Delay clearing selectionRect slightly to allow clicking on floating menu
        setTimeout(() => {
          const newSelection = window.getSelection();
          if (!newSelection || newSelection.toString().trim() === '') {
            setSelectionRect(null);
          }
        }, 200);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  useEffect(() => {
    if (!pdfFile || numPages === 0) return;
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.getAttribute('data-page-number') || '1', 10);
          setCurrentPage(pageNum);
        }
      });
    }, {
      root: pdfContainerRef.current,
      threshold: 0.5
    });

    const pageElements = document.querySelectorAll('.pdf-page-container');
    pageElements.forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [pdfFile, numPages, scale]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setIsSpacePanning(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePanning(false);
        setIsDraggingPan(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setScale(s => Math.min(Math.max(0.5, s + delta), 3.0));
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const handlePanStart = (e: React.MouseEvent) => {
    if (isSpacePanning || pdfTool === 'pan') {
      setIsDraggingPan(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      if (pdfContainerRef.current) {
        setScrollStart({ left: pdfContainerRef.current.scrollLeft, top: pdfContainerRef.current.scrollTop });
      }
    }
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (isDraggingPan && pdfContainerRef.current) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      pdfContainerRef.current.scrollLeft = scrollStart.left - dx;
      pdfContainerRef.current.scrollTop = scrollStart.top - dy;
    }
  };

  const handlePanEnd = () => {
    setIsDraggingPan(false);
  };

  const createBlankPdf = async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    page.drawText('Draft Paper', {
      x: 50,
      y: 800,
      size: 24,
      font,
      color: rgb(0.8, 0.8, 0.8),
    });

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const file = new File([blob], "draft.pdf", { type: 'application/pdf' });
    
    setPdfFile(file);
    setMode('create');
    setMessages([{
      id: 'welcome',
      role: 'ai',
      content: '我已经为您创建了一份空白的 PDF 草稿。我们可以开始创作论文了！您可以告诉我您的主题，或者让我帮您列一个大纲。如果您需要插入图表，只需告诉我数据和类型即可。您也可以直接点击下方的“手动输入文字”按钮，自己打字插入到 PDF 中。'
    }]);
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
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setMode('read');
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
      a.download = mode === 'create' ? 'my_paper.pdf' : 'annotated_paper.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('导出 PDF 失败，请重试。');
    } finally {
      setIsExporting(false);
    }
  };

  const callZhipuAPI = async (prompt: string, context: string, base64Pdf: string | null) => {
    if (!aiConfig.apiKey) {
      throw new Error("请在设置中配置智谱 API Key");
    }
    
    const messages = [];
    if (aiConfig.systemInstruction) {
      messages.push({ role: "system", content: aiConfig.systemInstruction });
    }
    
    let userContent = "";
    if (context) {
      userContent += `参考文本：\n"""\n${context}\n"""\n\n`;
    }
    userContent += `用户问题：${prompt}`;
    
    messages.push({ role: "user", content: userContent });

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: aiConfig.model || "glm-4",
        messages: messages,
        temperature: aiConfig.temperature,
        stream: false
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "智谱 API 请求失败");
    }

    const data = await response.json();
    return data.choices[0].message.content;
  };

  const extractChartData = (text: string) => {
    const jsonRegex = /```json\n([\s\S]*?)\n```/;
    const match = text.match(jsonRegex);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.chartType && parsed.data) {
          return {
            cleanText: text.replace(jsonRegex, '').trim(),
            chartData: parsed
          };
        }
      } catch (e) {
        console.error("Failed to parse chart JSON", e);
      }
    }
    return { cleanText: text, chartData: null };
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

    const aiMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: aiMessageId, role: 'ai', content: '' }]);

    try {
      let fullText = '';
      
      if (aiConfig.provider === 'zhipu') {
         fullText = await callZhipuAPI(promptText, contextText, pdfBase64);
         const { cleanText, chartData } = extractChartData(fullText);
         setMessages((prev) => 
            prev.map(msg => msg.id === aiMessageId ? { ...msg, content: cleanText, chartData } : msg)
         );
      } else {
        const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey || process.env.GEMINI_API_KEY });
        const parts: any[] = [];
        
        if (pdfBase64 && mode === 'read') {
          parts.push({
            inlineData: {
              data: pdfBase64,
              mimeType: 'application/pdf'
            }
          });
        }

        let fullPrompt = mode === 'read' ? `我附上了一份 PDF 文档。\n\n` : `我们正在创作一篇论文。\n\n`;
        if (userMessage.context) {
          fullPrompt += `请重点关注这段话：\n"""\n${userMessage.context}\n"""\n\n`;
        }
        fullPrompt += `要求：${userMessage.content}`;
        
        parts.push({ text: fullPrompt });

        const responseStream = await ai.models.generateContentStream({
          model: aiConfig.model,
          contents: { parts },
          config: {
            systemInstruction: aiConfig.systemInstruction,
            temperature: aiConfig.temperature,
          },
        });

        for await (const chunk of responseStream) {
          fullText += chunk.text;
          const { cleanText, chartData } = extractChartData(fullText);
          setMessages((prev) => 
            prev.map(msg => msg.id === aiMessageId ? { ...msg, content: cleanText, chartData } : msg)
          );
        }
      }
    } catch (error: any) {
      console.error('Error generating AI response:', error);
      setMessages((prev) => 
        prev.map(msg => msg.id === aiMessageId ? { ...msg, content: `抱歉，发生错误：${error.message || '请检查您的 API 密钥并重试。'}` } : msg)
      );
    } finally {
      setIsLoading(false);
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
      case 'chart': prompt = '请根据这段内容的数据，生成一个图表 (返回 JSON 格式)：'; break;
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

  const ToolButton = ({ icon, label, active, onClick, disabled, className }: { icon: React.ReactElement, label: string, active: boolean, onClick: () => void, disabled?: boolean, className?: string }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "p-2.5 rounded-xl transition-all flex items-center justify-center relative overflow-hidden group",
        disabled ? "opacity-50 cursor-not-allowed text-muted" : 
        active ? "bg-primary text-white shadow-[0_0_15px_rgba(var(--color-primary),0.5)]" : "text-muted hover:bg-secondary hover:text-content",
        className
      )}
      title={label}
    >
      {active && <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/20 to-white/0 translate-x-[-100%] animate-[shimmer_1.5s_infinite]" />}
      {React.cloneElement(icon as React.ReactElement<any>, { className: 'w-5 h-5 relative z-10' })}
    </button>
  );

  return (
    <div data-theme={theme} className="flex h-screen w-full bg-background text-content font-sans overflow-hidden transition-colors duration-300 selection:bg-primary/30">
      {/* Left Panel: PDF Viewer */}
      <div className="flex-1 flex flex-col border-r border-border-subtle bg-panel relative transition-colors duration-300">
        <div className="h-16 border-b border-border-subtle flex items-center justify-between px-6 bg-panel/80 backdrop-blur-md z-10 transition-colors duration-300">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-lg shadow-primary/20">
                <Sparkles className="w-6 h-6 text-white" />
             </div>
             <div>
                <h1 className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-content to-muted">PAA</h1>
                <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Personal Academic Assistant</p>
             </div>
          </div>
          
          {pdfFile && (
            <div className="flex items-center gap-2 bg-secondary/80 backdrop-blur-sm rounded-xl p-1 border border-border-subtle shadow-inner">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className="p-1.5 hover:bg-panel rounded-lg text-muted hover:text-content transition-all hover:shadow-sm" title="Zoom Out">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold w-12 text-center text-content font-mono">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(3.0, s + 0.1))} className="p-1.5 hover:bg-panel rounded-lg text-muted hover:text-content transition-all hover:shadow-sm" title="Zoom In">
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            {pdfFile && (
              <button 
                onClick={handleExport} 
                disabled={isExporting} 
                className="group relative overflow-hidden bg-secondary hover:bg-secondary/80 text-content px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 border border-border-subtle hover:border-primary/50 hover:shadow-[0_0_15px_rgba(var(--color-primary),0.2)]"
              >
                {isExporting ? <div className="w-4 h-4 border-2 border-content border-t-transparent rounded-full animate-spin"></div> : <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />}
                导出 PDF
              </button>
            )}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2.5 text-muted hover:text-primary hover:bg-primary/10 rounded-xl transition-all border border-transparent hover:border-primary/20"
              title="配置"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {pendingStampText && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-gradient-to-r from-primary to-purple-600 text-white px-6 py-3 rounded-2xl shadow-[0_10px_40px_rgba(var(--color-primary),0.4)] flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 border border-white/20 backdrop-blur-md">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
               <MousePointer2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold tracking-wide">在 PDF 任意位置点击即可插入文字</span>
            <button onClick={() => setPendingStampText(null)} className="ml-2 hover:bg-white/20 rounded-full p-1.5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {pdfTool === 'text' && !pendingStampText && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-panel text-content px-6 py-3 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.2)] flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 border border-primary/30 backdrop-blur-md">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center animate-pulse text-primary">
               <Type className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold tracking-wide">在 PDF 任意位置点击即可开始输入文字</span>
            <button onClick={() => setPdfTool('cursor')} className="ml-2 hover:bg-secondary rounded-full p-1.5 transition-colors text-muted hover:text-content">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {pdfTool === 'replace' && !pendingStampText && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-panel text-content px-6 py-3 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.2)] flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 border border-orange-500/30 backdrop-blur-md">
            <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center animate-pulse text-orange-500">
               <Edit3 className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold tracking-wide">框选需要修改的 PDF 原文，即可覆盖并重新输入</span>
            <button onClick={() => setPdfTool('cursor')} className="ml-2 hover:bg-secondary rounded-full p-1.5 transition-colors text-muted hover:text-content">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div 
          className={`flex-1 overflow-auto bg-background relative custom-scrollbar ${isSpacePanning || pdfTool === 'pan' ? (isDraggingPan ? 'cursor-grabbing' : 'cursor-grab') : ''}`} 
          ref={pdfContainerRef}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
        >
          {!pdfFile ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted">
              <div className="relative group cursor-pointer" onClick={() => document.getElementById('file-upload')?.click()}>
                 <div className="absolute inset-0 bg-primary/20 rounded-full blur-3xl group-hover:bg-primary/30 transition-all duration-500"></div>
                 <div className="w-32 h-32 rounded-3xl bg-panel border-2 border-dashed border-primary/50 flex items-center justify-center relative z-10 group-hover:scale-105 group-hover:border-primary transition-all duration-300 shadow-2xl">
                    <Upload className="w-12 h-12 text-primary group-hover:-translate-y-2 transition-transform duration-300" />
                 </div>
              </div>
              <h2 className="text-2xl font-bold mt-8 mb-2 bg-clip-text text-transparent bg-gradient-to-r from-content to-muted">开启您的学术之旅</h2>
              <p className="text-sm mb-8 max-w-md text-center">上传现有的 PDF 论文进行阅读和分析，或者创建一个空白草稿开始全新的创作。</p>
              
              <div className="flex gap-4">
                 <label className="cursor-pointer bg-primary text-white hover:bg-primary-hover px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(var(--color-primary),0.4)] hover:shadow-[0_0_30px_rgba(var(--color-primary),0.6)] hover:-translate-y-0.5">
                   <Upload className="w-5 h-5" />
                   导入 PDF 论文
                   <input id="file-upload" type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
                 </label>
                 <button onClick={createBlankPdf} className="bg-panel border border-border-subtle hover:border-primary hover:text-primary text-content px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg hover:-translate-y-0.5">
                   <FilePlus2 className="w-5 h-5" />
                   创作新论文
                 </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-center p-8 pb-40">
              <Document
                file={pdfFile}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                className="flex flex-col gap-8"
                loading={
                  <div className="flex flex-col items-center justify-center p-20 text-primary gap-4">
                    <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                    <span className="font-bold tracking-widest uppercase text-sm">Loading Document...</span>
                  </div>
                }
              >
                {Array.from(new Array(numPages), (el, index) => (
                  <div 
                    key={`page_${index + 1}`} 
                    data-page-number={index + 1}
                    className="pdf-page-container relative bg-white shadow-[0_0_40px_rgba(0,0,0,0.1)] rounded-sm overflow-hidden ring-1 ring-black/5 transition-transform duration-300 hover:shadow-[0_0_50px_rgba(0,0,0,0.15)]" 
                    style={{ width: `${800 * scale}px` }}
                  >
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
                      eraserSize={eraserSize}
                      textColor={textColor}
                      textSize={textSize}
                      replaceBgColor={replaceBgColor}
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
          
          {/* Floating Page Indicator */}
          {pdfFile && numPages > 0 && (
            <div 
              className="fixed top-24 left-[calc(50%-200px)] -translate-x-1/2 z-20 bg-panel/80 backdrop-blur-md border border-white/10 shadow-[0_5px_20px_rgba(0,0,0,0.1)] px-4 py-1.5 rounded-full text-xs font-bold text-muted flex items-center gap-2 cursor-pointer hover:bg-panel hover:text-content transition-all" 
              onClick={() => pdfContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              title="回到顶部"
            >
              <span>{currentPage} / {numPages}</span>
            </div>
          )}
          
          {/* PDF Toolbar */}
          {pdfFile && (
            <div className="fixed left-6 top-1/2 -translate-y-1/2 bg-panel/90 backdrop-blur-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.3)] rounded-2xl flex flex-col overflow-visible z-20 transition-all duration-300 hover:shadow-[0_20px_60px_rgba(var(--color-primary),0.2)]">
              {/* Tool Options Popout */}
              {pdfTool !== 'cursor' && pdfTool !== 'pan' && (
                <div className="absolute left-[calc(100%+12px)] top-0 bg-panel/95 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.3)] rounded-2xl flex flex-col gap-4 p-4 animate-in slide-in-from-left-2 duration-200 w-48">
                  {pdfTool !== 'replace' && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Size</span>
                      <input
                        type="range"
                        min={pdfTool === 'highlight' ? 10 : pdfTool === 'eraser' ? 10 : 1}
                        max={pdfTool === 'highlight' ? 50 : pdfTool === 'eraser' ? 100 : 30}
                        value={pdfTool === 'draw' ? drawSize : pdfTool === 'highlight' ? highlightSize : pdfTool === 'eraser' ? eraserSize : textSize}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (pdfTool === 'draw') setDrawSize(val);
                          else if (pdfTool === 'highlight') setHighlightSize(val);
                          else if (pdfTool === 'eraser') setEraserSize(val);
                          else setTextSize(val);
                        }}
                        className="w-full accent-primary h-1.5 bg-secondary rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(var(--color-primary),0.8)]"
                      />
                    </div>
                  )}
                  {pdfTool !== 'eraser' && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Color</span>
                      <div className="relative w-8 h-8 rounded-full overflow-hidden ring-2 ring-white/20 shadow-inner">
                         <input
                           type="color"
                           value={pdfTool === 'draw' ? drawColor : pdfTool === 'highlight' ? highlightColor : textColor}
                           onChange={(e) => {
                             const val = e.target.value;
                             if (pdfTool === 'draw') setDrawColor(val);
                             else if (pdfTool === 'highlight') setHighlightColor(val);
                             else setTextColor(val);
                           }}
                           className="absolute -inset-2 w-12 h-12 cursor-pointer border-0 p-0"
                         />
                      </div>
                    </div>
                  )}
                  {pdfTool === 'replace' && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Bg Color</span>
                      <div className="flex items-center gap-2">
                        <div className="relative w-8 h-8 rounded-full overflow-hidden ring-2 ring-white/20 shadow-inner">
                           <input
                             type="color"
                             value={replaceBgColor}
                             onChange={(e) => setReplaceBgColor(e.target.value)}
                             className="absolute -inset-2 w-12 h-12 cursor-pointer border-0 p-0"
                           />
                        </div>
                        {'EyeDropper' in window && (
                          <button
                            onClick={async () => {
                              try {
                                const eyeDropper = new (window as any).EyeDropper();
                                const result = await eyeDropper.open();
                                setReplaceBgColor(result.sRGBHex);
                              } catch (e) {
                                // User canceled
                              }
                            }}
                            className="p-2 bg-secondary hover:bg-primary/20 text-muted hover:text-primary rounded-lg transition-colors"
                            title="吸取 PDF 背景色"
                          >
                            <Pipette className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tools */}
              <div className="flex flex-col items-center gap-1.5 p-2.5">
                <ToolButton icon={<MousePointer2 />} label="选择文本" active={pdfTool === 'cursor'} onClick={() => setPdfTool('cursor')} />
                <ToolButton icon={<Hand />} label="拖拽平移 (Space)" active={pdfTool === 'pan' || isSpacePanning} onClick={() => setPdfTool('pan')} />
                <div className="h-px w-8 bg-gradient-to-r from-transparent via-border-subtle to-transparent my-1"></div>
                <ToolButton icon={<Edit3 />} label="直接修改PDF (框选覆盖)" active={pdfTool === 'replace'} onClick={() => setPdfTool('replace')} className="hover:text-orange-400" />
                <ToolButton icon={<Type />} label="插入文字" active={pdfTool === 'text'} onClick={() => setPdfTool('text')} className="hover:text-green-400" />
                <div className="h-px w-8 bg-gradient-to-r from-transparent via-border-subtle to-transparent my-1"></div>
                <ToolButton icon={<Highlighter />} label="高亮" active={pdfTool === 'highlight'} onClick={() => setPdfTool('highlight')} className="hover:text-yellow-400" />
                <ToolButton icon={<Pen />} label="画笔" active={pdfTool === 'draw'} onClick={() => setPdfTool('draw')} className="hover:text-blue-400" />
                <ToolButton icon={<Eraser />} label="擦除批注" active={pdfTool === 'eraser'} onClick={() => setPdfTool('eraser')} className="hover:text-red-400" />
                <div className="h-px w-8 bg-gradient-to-r from-transparent via-border-subtle to-transparent my-1"></div>
                <ToolButton icon={<Undo2 />} label="撤销" active={false} onClick={handleUndo} disabled={globalHistory.length === 0} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Context Menu */}
      {selectionRect && selectedText && (
        <div
          className="fixed z-50 bg-panel/95 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.3)] rounded-xl flex items-center p-1.5 gap-1 animate-in zoom-in-95 duration-200"
          style={{
            top: Math.max(10, selectionRect.top - 60),
            left: selectionRect.left + selectionRect.width / 2,
            transform: 'translateX(-50%)'
          }}
        >
          <button onClick={() => { navigator.clipboard.writeText(selectedText); setSelectionRect(null); }} className="p-2 hover:bg-secondary rounded-lg text-xs font-bold flex items-center gap-1.5 text-content transition-colors" title="Copy">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-border-subtle mx-1"></div>
          <button onClick={() => { handleQuickAction('explain'); setIsChatOpen(true); }} className="p-2 hover:bg-secondary rounded-lg text-xs font-bold flex items-center gap-1.5 text-content transition-colors">
            <Wand2 className="w-3.5 h-3.5 text-primary" /> 解释
          </button>
          <button onClick={() => { handleQuickAction('translate'); setIsChatOpen(true); }} className="p-2 hover:bg-secondary rounded-lg text-xs font-bold flex items-center gap-1.5 text-content transition-colors">
            <Languages className="w-3.5 h-3.5 text-blue-400" /> 翻译
          </button>
          <button onClick={() => { handleQuickAction('summarize'); setIsChatOpen(true); }} className="p-2 hover:bg-secondary rounded-lg text-xs font-bold flex items-center gap-1.5 text-content transition-colors">
            <AlignLeft className="w-3.5 h-3.5 text-green-400" /> 总结
          </button>
        </div>
      )}

      {/* Right Panel: Chat Interface */}
      <div className={`flex flex-col bg-panel/95 backdrop-blur-2xl shadow-[-10px_0_30px_rgba(0,0,0,0.1)] z-20 transition-all duration-300 border-l border-white/5 ${isChatOpen ? 'w-[450px]' : 'w-0 border-l-0 overflow-hidden'}`}>
        <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-gradient-to-r from-transparent to-primary/5 shrink-0 w-[450px]">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
                <Bot className="w-4 h-4 text-primary" />
             </div>
             <div>
                <h2 className="font-bold text-sm tracking-wide">{aiConfig.provider === 'gemini' ? 'Gemini AI' : 'Zhipu AI'}</h2>
                <div className="flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_#22c55e]"></div>
                   <span className="text-[10px] text-muted uppercase tracking-wider">{mode === 'create' ? 'Writing Mode' : 'Reading Mode'}</span>
                </div>
             </div>
          </div>
          <div className="flex gap-2">
             <span className="text-xs font-mono bg-secondary px-2 py-1 rounded-md text-muted border border-border-subtle">{aiConfig.model}</span>
             <button onClick={() => setIsChatOpen(false)} className="p-1.5 hover:bg-secondary rounded-lg text-muted hover:text-content transition-colors">
               <PanelRightClose className="w-4 h-4" />
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative w-[450px]">
           {/* Background glow */}
           <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-primary/5 blur-[100px] pointer-events-none"></div>
           
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted space-y-6 animate-in fade-in duration-700">
              <div className="relative">
                 <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse"></div>
                 <div className="w-20 h-20 rounded-2xl bg-panel border border-white/10 flex items-center justify-center relative z-10 shadow-2xl">
                    <Bot className="w-10 h-10 text-primary" />
                 </div>
              </div>
              <div className="space-y-2">
                 <h3 className="text-lg font-bold text-content">准备就绪</h3>
                 <p className="text-sm px-8 max-w-xs leading-relaxed">
                   {mode === 'create' ? '告诉我想写什么，或者让我帮您生成图表数据。' : '选中左侧文本进行分析，或者直接向我提问。'}
                 </p>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-4 fade-in duration-300`}>
                <div className={`flex items-start gap-3 max-w-[95%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${msg.role === 'user' ? 'bg-gradient-to-br from-primary to-purple-600 text-white' : 'bg-panel border border-white/10 text-primary'}`}>
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'} w-full`}>
                    {msg.context && (
                      <div className="bg-panel border border-primary/20 text-content text-xs p-3 rounded-xl max-w-full overflow-hidden text-ellipsis line-clamp-3 shadow-inner relative group">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-xl"></div>
                        <span className="font-bold block mb-1 text-primary uppercase tracking-wider text-[10px]">Reference</span>
                        <span className="italic opacity-80">"{msg.context}"</span>
                      </div>
                    )}
                    <div className={`px-5 py-4 rounded-2xl text-sm w-full shadow-lg ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-primary to-purple-600 text-white rounded-tr-sm'
                        : 'bg-panel border border-white/5 text-content rounded-tl-sm'
                    }`}>
                      {msg.role === 'ai' ? (
                        <div className="prose prose-sm max-w-none prose-zinc dark:prose-invert prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10">
                          <Markdown>{msg.content}</Markdown>
                          {msg.chartData && (
                            <DynamicChart data={msg.chartData.data} type={msg.chartData.chartType} />
                          )}
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                    {msg.role === 'ai' && msg.content && !isLoading && (
                      <div className="flex items-center gap-2 mt-1 ml-1">
                        <button 
                          onClick={() => {
                            setPdfTool('cursor');
                            setPendingStampText(msg.content);
                          }}
                          className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-muted hover:text-primary transition-all bg-panel px-3 py-1.5 rounded-lg border border-border-subtle hover:border-primary/50 hover:shadow-[0_0_10px_rgba(var(--color-primary),0.2)] group"
                        >
                          <MousePointer2 className="w-3 h-3 group-hover:-translate-y-0.5 transition-transform" /> 插入到 PDF
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex items-start gap-3 animate-in fade-in">
              <div className="w-8 h-8 rounded-xl bg-panel border border-white/10 text-primary flex items-center justify-center shrink-0 shadow-lg">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-panel border border-white/5 text-content px-5 py-4 rounded-2xl rounded-tl-sm text-sm flex items-center gap-2 shadow-lg">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s] shadow-[0_0_5px_rgba(var(--color-primary),0.8)]"></div>
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s] shadow-[0_0_5px_rgba(var(--color-primary),0.8)]"></div>
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce shadow-[0_0_5px_rgba(var(--color-primary),0.8)]"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-5 bg-panel/80 backdrop-blur-xl border-t border-white/5 transition-colors duration-300 relative z-10 shrink-0 w-[450px]">
          {selectedText && (
            <div className="mb-4 animate-in slide-in-from-bottom-2">
              <div className="flex items-start justify-between bg-primary/10 border border-primary/30 rounded-xl p-3 mb-3 shadow-inner">
                <div className="text-xs text-content line-clamp-2 pr-2">
                  <span className="font-bold text-primary uppercase tracking-wider text-[10px] mr-2">Selected</span>
                  <span className="opacity-80">"{selectedText}"</span>
                </div>
                <button
                  onClick={() => setSelectedText('')}
                  className="text-muted hover:text-primary shrink-0 transition-colors bg-panel rounded-full p-1 border border-white/5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => handleQuickAction('explain')} className="text-[11px] font-bold flex items-center gap-1.5 bg-panel hover:bg-primary hover:text-white text-content px-3 py-2 rounded-lg transition-all border border-border-subtle hover:border-primary shadow-sm hover:shadow-[0_0_15px_rgba(var(--color-primary),0.4)]">
                  <Wand2 className="w-3 h-3" /> 解释
                </button>
                <button onClick={() => handleQuickAction('summarize')} className="text-[11px] font-bold flex items-center gap-1.5 bg-panel hover:bg-primary hover:text-white text-content px-3 py-2 rounded-lg transition-all border border-border-subtle hover:border-primary shadow-sm hover:shadow-[0_0_15px_rgba(var(--color-primary),0.4)]">
                  <AlignLeft className="w-3 h-3" /> 总结
                </button>
                <button onClick={() => handleQuickAction('translate')} className="text-[11px] font-bold flex items-center gap-1.5 bg-panel hover:bg-primary hover:text-white text-content px-3 py-2 rounded-lg transition-all border border-border-subtle hover:border-primary shadow-sm hover:shadow-[0_0_15px_rgba(var(--color-primary),0.4)]">
                  <Languages className="w-3 h-3" /> 翻译
                </button>
                <button onClick={() => handleQuickAction('expand')} className="text-[11px] font-bold flex items-center gap-1.5 bg-panel hover:bg-primary hover:text-white text-content px-3 py-2 rounded-lg transition-all border border-border-subtle hover:border-primary shadow-sm hover:shadow-[0_0_15px_rgba(var(--color-primary),0.4)]">
                  <Pen className="w-3 h-3" /> 扩写
                </button>
                <button onClick={() => handleQuickAction('chart')} className="text-[11px] font-bold flex items-center gap-1.5 bg-panel hover:bg-primary hover:text-white text-content px-3 py-2 rounded-lg transition-all border border-border-subtle hover:border-primary shadow-sm hover:shadow-[0_0_15px_rgba(var(--color-primary),0.4)]">
                  <BarChart3 className="w-3 h-3" /> 生成图表
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2 mb-2">
            <button 
              onClick={() => {
                setPdfTool('text');
                // Optional: show a small toast or hint that text mode is active
              }}
              className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-muted hover:text-primary transition-all bg-panel px-3 py-1.5 rounded-lg border border-border-subtle hover:border-primary/50 hover:shadow-[0_0_10px_rgba(var(--color-primary),0.2)]"
            >
              <Edit3 className="w-3 h-3" /> 手动输入文字
            </button>
          </div>
          <div className="relative flex items-end group">
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
              placeholder="输入指令，或让 AI 帮您生成图表..."
              className="w-full bg-secondary/50 border border-border-subtle focus:bg-panel focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-2xl pl-5 pr-14 py-4 text-sm resize-none outline-none transition-all text-content placeholder:text-muted shadow-inner"
              rows={1}
              style={{ minHeight: '56px', maxHeight: '150px' }}
            />
            <button
              onClick={handleSendMessage}
              disabled={(!input.trim() && !selectedText) || isLoading}
              className="absolute right-2 bottom-2 p-2.5 bg-gradient-to-br from-primary to-purple-600 text-white rounded-xl hover:shadow-[0_0_20px_rgba(var(--color-primary),0.6)] disabled:opacity-50 disabled:hover:shadow-none transition-all group-focus-within:scale-105"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating Chat Toggle Button */}
      {!isChatOpen && (
        <button 
          onClick={() => setIsChatOpen(true)}
          className="fixed right-6 top-6 z-40 bg-panel/90 backdrop-blur-md border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.2)] p-3 rounded-2xl text-content hover:text-primary transition-all hover:scale-105 group"
        >
          <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <PanelRightOpen className="w-6 h-6 relative z-10" />
        </button>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-panel text-content rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] w-full max-w-lg overflow-hidden border border-white/10 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-white/5 bg-gradient-to-r from-transparent to-primary/5">
              <h3 className="font-bold text-xl flex items-center gap-2"><Settings className="w-5 h-5 text-primary"/> 系统配置</h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-muted hover:text-white bg-secondary p-2 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-3">UI Theme</label>
                <div className="flex gap-3">
                  {(['dark', 'light', 'sepia'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`flex-1 py-3 rounded-xl text-sm font-bold capitalize border transition-all ${theme === t ? 'border-primary bg-primary/10 text-primary shadow-[0_0_15px_rgba(var(--color-primary),0.2)]' : 'border-border-subtle text-muted hover:bg-secondary hover:border-white/20'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="h-px w-full bg-gradient-to-r from-transparent via-border-subtle to-transparent"></div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2">AI Provider</label>
                   <select
                     value={aiConfig.provider}
                     onChange={(e) => setAiConfig({ ...aiConfig, provider: e.target.value as AIProvider, model: e.target.value === 'gemini' ? 'gemini-3.1-pro-preview' : 'glm-4' })}
                     className="w-full border border-border-subtle bg-secondary text-content rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all appearance-none"
                   >
                     <option value="gemini">Google Gemini</option>
                     <option value="zhipu">智谱 AI (GLM)</option>
                   </select>
                 </div>
                 <div>
                   <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2">Model</label>
                   <input
                     type="text"
                     value={aiConfig.model}
                     onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                     className="w-full border border-border-subtle bg-secondary text-content rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                   />
                 </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2">API Key {aiConfig.provider === 'gemini' && '(Optional in AI Studio)'}</label>
                <input
                  type="password"
                  value={aiConfig.apiKey}
                  onChange={(e) => setAiConfig({ ...aiConfig, apiKey: e.target.value })}
                  placeholder={`输入您的 ${aiConfig.provider === 'gemini' ? 'Gemini' : '智谱'} API Key`}
                  className="w-full border border-border-subtle bg-secondary text-content rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2">System Instruction</label>
                <textarea
                  value={aiConfig.systemInstruction}
                  onChange={(e) => setAiConfig({ ...aiConfig, systemInstruction: e.target.value })}
                  className="w-full border border-border-subtle bg-secondary text-content rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all h-24 resize-none custom-scrollbar"
                />
              </div>
            </div>
            <div className="p-6 border-t border-white/5 bg-black/20 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="bg-gradient-to-r from-primary to-purple-600 text-white px-8 py-3 rounded-xl text-sm font-bold hover:shadow-[0_0_20px_rgba(var(--color-primary),0.5)] transition-all hover:-translate-y-0.5 flex items-center gap-2"
              >
                保存配置 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}