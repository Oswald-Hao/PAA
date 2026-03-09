import React, { useState, useEffect, useRef } from 'react';
import { Upload, Settings, MessageSquare, X, Send, Bot, User, MousePointer2, Highlighter, Pen, Eraser } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { Document, Page, pdfjs } from 'react-pdf';
import Markdown from 'react-markdown';
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

const PageOverlay = ({ tool }: { tool: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

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
              context.drawImage(tempCanvas, 0, 0);
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
  }, []);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (tool === 'cursor' || !ctx) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || tool === 'cursor' || !ctx) return;
    if (e.cancelable) e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    if (tool === 'highlight') {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.3)';
      ctx.lineWidth = 24;
      ctx.globalCompositeOperation = 'source-over';
    } else if (tool === 'draw') {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
      ctx.lineWidth = 3;
      ctx.globalCompositeOperation = 'source-over';
    } else if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 30;
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
    <canvas
      ref={canvasRef}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      onTouchStart={startDrawing}
      onTouchMove={draw}
      onTouchEnd={stopDrawing}
      className="absolute inset-0 z-10 touch-none"
      style={{ pointerEvents: tool === 'cursor' ? 'none' : 'auto' }}
    />
  );
};

export default function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [selectedText, setSelectedText] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('light');
  const [pdfTool, setPdfTool] = useState<'cursor' | 'draw' | 'highlight' | 'eraser'>('cursor');
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    model: 'gemini-3-flash-preview',
    systemInstruction: 'You are a helpful assistant that answers questions based on the provided document. The user may also provide specific selected text as context. Use the entire document to understand the context, but focus on the selected text if provided.',
    temperature: 0.7,
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPdfBase64(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() && !selectedText) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      context: selectedText,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

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

      let promptText = '';
      if (userMessage.context) {
        promptText += `The user has selected the following specific text from the document as context for their question:\n"""\n${userMessage.context}\n"""\n\n`;
      }
      promptText += `User Question: ${userMessage.content}`;
      
      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: aiConfig.model,
        contents: { parts },
        config: {
          systemInstruction: aiConfig.systemInstruction,
          temperature: aiConfig.temperature,
        },
      });

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: response.text || 'Sorry, I could not generate a response.',
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error generating AI response:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: 'Sorry, there was an error communicating with the AI. Please check your API key and try again.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div data-theme={theme} className="flex h-screen w-full bg-background text-content font-sans overflow-hidden transition-colors duration-200">
      {/* Left Panel: PDF Viewer */}
      <div className="flex-1 flex flex-col border-r border-border-subtle bg-panel relative transition-colors duration-200">
        <div className="h-14 border-b border-border-subtle flex items-center justify-between px-4 bg-panel z-10 transition-colors duration-200">
          <h1 className="font-semibold text-lg flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            PDF AI Chat
          </h1>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer bg-primary text-white hover:bg-primary-hover px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload PDF
              <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-background relative" ref={pdfContainerRef}>
          {!pdfFile ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted">
              <Upload className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No PDF loaded</p>
              <p className="text-sm">Upload a PDF to start reading and chatting</p>
            </div>
          ) : (
            <div className="flex justify-center p-4 pb-24">
              <Document
                file={pdfFile}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                className="flex flex-col gap-4"
                loading={
                  <div className="flex items-center justify-center p-12 text-muted">
                    Loading PDF...
                  </div>
                }
              >
                {Array.from(new Array(numPages), (el, index) => (
                  <div key={`page_${index + 1}`} className="relative bg-panel shadow-sm rounded-sm overflow-hidden">
                    <Page
                      pageNumber={index + 1}
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                      className="max-w-full"
                      width={800}
                    />
                    <PageOverlay tool={pdfTool} />
                  </div>
                ))}
              </Document>
            </div>
          )}
          
          {/* PDF Toolbar */}
          {pdfFile && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-panel border border-border-subtle shadow-lg rounded-full px-4 py-2 flex items-center gap-2 z-20 transition-colors duration-200">
              <button onClick={() => setPdfTool('cursor')} className={`p-2 rounded-full transition-colors ${pdfTool === 'cursor' ? 'bg-secondary text-primary' : 'text-muted hover:bg-secondary hover:text-content'}`} title="Select Text">
                <MousePointer2 className="w-5 h-5" />
              </button>
              <div className="w-px h-6 bg-border-subtle mx-1"></div>
              <button onClick={() => setPdfTool('highlight')} className={`p-2 rounded-full transition-colors ${pdfTool === 'highlight' ? 'bg-secondary text-primary' : 'text-muted hover:bg-secondary hover:text-content'}`} title="Highlight">
                <Highlighter className="w-5 h-5" />
              </button>
              <button onClick={() => setPdfTool('draw')} className={`p-2 rounded-full transition-colors ${pdfTool === 'draw' ? 'bg-secondary text-primary' : 'text-muted hover:bg-secondary hover:text-content'}`} title="Draw Notes">
                <Pen className="w-5 h-5" />
              </button>
              <button onClick={() => setPdfTool('eraser')} className={`p-2 rounded-full transition-colors ${pdfTool === 'eraser' ? 'bg-secondary text-primary' : 'text-muted hover:bg-secondary hover:text-content'}`} title="Eraser">
                <Eraser className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Chat Interface */}
      <div className="w-96 flex flex-col bg-panel shadow-[-4px_0_24px_rgba(0,0,0,0.02)] z-20 transition-colors duration-200">
        <div className="h-14 border-b border-border-subtle flex items-center justify-between px-4">
          <h2 className="font-medium flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            {aiConfig.model}
          </h2>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-muted hover:text-content hover:bg-secondary rounded-md transition-colors"
            title="AI Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted space-y-3">
              <Bot className="w-10 h-10 opacity-50" />
              <p className="text-sm px-6">
                I have access to the full PDF document. Select text to ask about specific parts, or ask me anything about the whole file!
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-start gap-2 max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted'}`}>
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {msg.context && (
                      <div className="bg-primary/5 border border-primary/20 text-content text-xs p-2 rounded-md max-w-full overflow-hidden text-ellipsis line-clamp-3">
                        <span className="font-semibold block mb-1 text-primary">Context:</span>
                        "{msg.context}"
                      </div>
                    )}
                    <div className={`px-4 py-2 rounded-2xl text-sm ${
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
            <div className="mb-3 flex items-start justify-between bg-primary/5 border border-primary/20 rounded-md p-2">
              <div className="text-xs text-content line-clamp-2 pr-2">
                <span className="font-semibold text-primary">Selected: </span>
                "{selectedText}"
              </div>
              <button
                onClick={() => setSelectedText('')}
                className="text-muted hover:text-content shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
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
              placeholder="Ask a question..."
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
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-panel text-content rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-border-subtle">
            <div className="flex items-center justify-between p-4 border-b border-border-subtle">
              <h3 className="font-semibold text-lg">Configuration</h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-muted hover:text-content"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">UI Theme</label>
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
                <label className="block text-sm font-medium mb-1">Model</label>
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
                <label className="block text-sm font-medium mb-1">System Instruction</label>
                <textarea
                  value={aiConfig.systemInstruction}
                  onChange={(e) => setAiConfig({ ...aiConfig, systemInstruction: e.target.value })}
                  className="w-full border border-border-subtle bg-secondary text-content rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 h-24 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Temperature: {aiConfig.temperature}
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
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
